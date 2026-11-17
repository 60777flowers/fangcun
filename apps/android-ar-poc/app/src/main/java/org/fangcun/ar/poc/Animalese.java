package org.fangcun.ar.poc;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;

import java.util.ArrayDeque;
import java.util.Random;

/**
 * Animal-Crossing-style "animalese" voice: a fast sequence of short pitch-shifted blips, one per
 * character, synthesised locally with {@link AudioTrack} (22050 Hz mono 16-bit PCM).
 *
 * <p>PCM generation and the (blocking) {@link AudioTrack#write} both run on a dedicated daemon
 * thread fed by a tiny line queue, so the UI and GL threads are never blocked. Lines are capped at
 * ~2.5 s / {@link #MAX_LINE_CHARS} characters. Nothing plays while {@link #setPaused(boolean)} or
 * {@link #setMuted(boolean)} is active.</p>
 */
final class Animalese {
    private static final String TAG = "Animalese";
    private static final int SAMPLE_RATE = 22050;
    private static final int MAX_LINE_CHARS = 48;
    private static final int MAX_LINE_SAMPLES = (int) (SAMPLE_RATE * 2.5f);
    private static final int MAX_QUEUED_LINES = 3;

    // ---- tunable voice character (higher/thinner = small cute whale girl) -------------------
    /** Random base pitch range per line; raised from the original 240-420 Hz. */
    private static final float BASE_PITCH_MIN_HZ = 340f;
    private static final float BASE_PITCH_MAX_HZ = 560f;
    /** Per-character pitch spread around the base; narrowed so the voice sounds "thin". */
    private static final float CHAR_PITCH_MIN = 0.92f;
    private static final float CHAR_PITCH_STEPS = 0.02f;
    private static final float CHAR_PITCH_RANDOM = 0.10f;
    /** Blip length: short and delicate (30-45 ms). */
    private static final float BLIP_MIN_SECONDS = 0.030f;
    private static final float BLIP_MAX_SECONDS = 0.045f;
    /** Bright waveform: fundamental + a soft second harmonic (no buzzy third harmonic). */
    private static final double SECOND_HARMONIC_GAIN = 0.22;
    private static final double VIBRATO_DEPTH = 0.010;
    private static final float VIBRATO_MIN_HZ = 26f;
    private static final float VIBRATO_MAX_HZ = 44f;
    /** Fast attack, soft decay envelope. */
    private static final float ATTACK_FRACTION = 0.07f;
    private static final double DECAY_RATE = 3.4;
    /** Question/exclamation lines get a small rising glide. */
    private static final float PUNCTUATION_RISE = 0.12f;
    private static final float PUNCTUATION_BLIP_RISE = 0.04f;
    private static final float VOLUME = 0.30f;
    private float pitchScale = 1f;

    private final ArrayDeque<String> pending = new ArrayDeque<>();
    private final Object lock = new Object();
    private final Random random = new Random();
    private AudioTrack track;
    private Thread worker;
    private volatile boolean muted;
    private volatile boolean paused;
    private volatile boolean shuttingDown;

    /** Debug tuning hook (`--ef voicePitch 1.3`): multiplies the base pitch without recompiling. */
    void setPitchScale(float scale) {
        pitchScale = Math.max(0.5f, Math.min(2.5f, scale));
        Log.i(TAG, "pitchScale=" + pitchScale);
    }

    /** Mute toggle from the gear settings (default voice ON). */
    void setMuted(boolean value) {
        if (muted == value) return;
        muted = value;
        Log.i(TAG, "muted=" + value);
        if (value) stopCurrent();
    }

    boolean isMuted() { return muted; }

    /** Called from the activity lifecycle: nothing may play while the app is paused. */
    void setPaused(boolean value) {
        paused = value;
        if (value) stopCurrent();
    }

    /** Enqueues one spoken line. Fast (never blocks); returns false when muted/paused. */
    boolean speak(String text) {
        if (text == null || text.isEmpty() || muted || paused) return false;
        synchronized (lock) {
            while (pending.size() >= MAX_QUEUED_LINES) pending.pollFirst();
            pending.addLast(text);
            lock.notifyAll();
        }
        ensureWorker();
        return true;
    }

    void release() {
        shuttingDown = true;
        synchronized (lock) {
            pending.clear();
            lock.notifyAll();
        }
        if (worker != null) worker.interrupt();
        releaseTrack();
    }

    private void stopCurrent() {
        synchronized (lock) {
            pending.clear();
        }
        AudioTrack current = track;
        if (current == null) return;
        try {
            current.pause();
            current.flush();
            Log.i(TAG, "stopped playState=" + current.getPlayState());
        } catch (RuntimeException error) {
            Log.w(TAG, "stop failed: " + error);
        }
    }

    private void releaseTrack() {
        AudioTrack current = track;
        track = null;
        if (current == null) return;
        try {
            current.pause();
            current.flush();
            current.release();
        } catch (RuntimeException ignored) {
            // best effort
        }
    }

    private void ensureWorker() {
        Thread current = worker;
        if (current != null && current.isAlive()) return;
        Thread thread = new Thread(this::runLoop, "fangcun-animalese");
        thread.setDaemon(true);
        worker = thread;
        thread.start();
    }

    private void runLoop() {
        while (!shuttingDown) {
            String line;
            synchronized (lock) {
                while (pending.isEmpty() && !shuttingDown) {
                    try {
                        lock.wait(500L);
                    } catch (InterruptedException interrupted) {
                        return;
                    }
                }
                if (shuttingDown) return;
                line = pending.pollFirst();
            }
            if (line == null || muted || paused) continue;
            try {
                short[] pcm = synthesize(line);
                if (pcm == null || pcm.length == 0 || muted || paused) continue;
                AudioTrack current = ensureTrack();
                if (current == null) continue;
                if (current.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) current.play();
                Log.i(TAG, "playing chars=" + countSpeakable(line) + " samples=" + pcm.length
                    + " durationMs=" + (pcm.length * 1000 / SAMPLE_RATE));
                int written = 0;
                while (written < pcm.length && !muted && !paused && !shuttingDown) {
                    int chunk = Math.min(4096, pcm.length - written);
                    int result = current.write(pcm, written, chunk);
                    if (result < 0) {
                        Log.w(TAG, "AudioTrack.write failed: " + result);
                        break;
                    }
                    written += result;
                }
                Log.i(TAG, "line done playState=" + current.getPlayState() + " bytes=" + (written * 2));
            } catch (RuntimeException error) {
                Log.w(TAG, "animalese line failed: " + error);
                stopCurrent();
            }
        }
    }

    private AudioTrack ensureTrack() {
        AudioTrack current = track;
        if (current != null && current.getState() == AudioTrack.STATE_INITIALIZED) return current;
        int minBuffer = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT);
        int bufferSize = Math.max(minBuffer, SAMPLE_RATE * 2 / 2); // ~500 ms of 16-bit mono
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_GAME)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        AudioFormat format = new AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build();
        AudioTrack created = new AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(bufferSize)
            .build();
        if (created.getState() != AudioTrack.STATE_INITIALIZED) {
            Log.w(TAG, "AudioTrack init failed state=" + created.getState());
            created.release();
            return null;
        }
        created.play();
        track = created;
        Log.i(TAG, "track ready rate=" + SAMPLE_RATE + " state=" + created.getState()
            + " playState=" + created.getPlayState() + " buffer=" + bufferSize);
        return created;
    }

    /**
     * Synthesises the whole line into one PCM buffer (off the UI/GL threads). One blip per
     * speakable character: 30-45 ms, bright sine + soft 2nd harmonic, fast attack and soft decay,
     * a slight vibrato, random per-line base pitch and a rising glide on question/exclamation
     * lines. All character constants live at the top of this class for easy tuning.
     */
    private short[] synthesize(String text) {
        boolean rising = text.indexOf('?') >= 0 || text.indexOf('？') >= 0
            || text.indexOf('!') >= 0 || text.indexOf('！') >= 0;
        int count = countSpeakable(text);
        if (count == 0) return null;
        float baseHz = (BASE_PITCH_MIN_HZ + random.nextFloat() * (BASE_PITCH_MAX_HZ - BASE_PITCH_MIN_HZ))
            * pitchScale;
        float[] buffer = new float[MAX_LINE_SAMPLES];
        int length = 0;
        int spoken = 0;
        for (int index = 0; index < text.length() && length < MAX_LINE_SAMPLES && spoken < count; ) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (!isSpeakable(codePoint)) continue;
            float lineProgress = count <= 1 ? 0f : spoken / (float) (count - 1);
            float pitch = baseHz * (CHAR_PITCH_MIN + (codePoint % 7) * CHAR_PITCH_STEPS
                + random.nextFloat() * CHAR_PITCH_RANDOM);
            if (rising) pitch *= 1f + PUNCTUATION_RISE * lineProgress;
            spoken += 1;
            int samples = (int) ((BLIP_MIN_SECONDS + random.nextFloat() * (BLIP_MAX_SECONDS - BLIP_MIN_SECONDS))
                * SAMPLE_RATE);
            double phase = 0.0;
            double vibratoHz = VIBRATO_MIN_HZ + random.nextDouble() * (VIBRATO_MAX_HZ - VIBRATO_MIN_HZ);
            for (int sample = 0; sample < samples && length < MAX_LINE_SAMPLES; sample += 1) {
                float progress = sample / (float) samples;
                double vibrato = 1.0 + VIBRATO_DEPTH * Math.sin(2.0 * Math.PI * vibratoHz * sample / SAMPLE_RATE);
                double blipRise = rising ? 1.0 + PUNCTUATION_BLIP_RISE * progress : 1.0;
                phase += 2.0 * Math.PI * pitch * vibrato * blipRise / SAMPLE_RATE;
                if (phase > 2.0 * Math.PI) phase -= 2.0 * Math.PI;
                double tone = Math.sin(phase) + SECOND_HARMONIC_GAIN * Math.sin(2.0 * phase);
                float envelope = progress < ATTACK_FRACTION
                    ? progress / ATTACK_FRACTION
                    : (float) Math.exp(-DECAY_RATE * (progress - ATTACK_FRACTION));
                buffer[length] = (float) (tone * envelope * VOLUME);
                length += 1;
            }
            int gap = (int) (random.nextFloat() * 0.005f * SAMPLE_RATE);
            length = Math.min(MAX_LINE_SAMPLES, length + gap);
        }
        short[] pcm = new short[length];
        for (int index = 0; index < length; index += 1) {
            float value = Math.max(-1f, Math.min(1f, buffer[index]));
            pcm[index] = (short) (value * Short.MAX_VALUE);
        }
        Log.i(TAG, String.format(java.util.Locale.US,
            "synth chars=%d baseHz=%.0f rising=%s samples=%d", count, baseHz, rising, pcm.length));
        return pcm;
    }

    private static boolean isSpeakable(int codePoint) {
        return Character.isLetterOrDigit(codePoint);
    }

    private static int countSpeakable(String text) {
        int count = 0;
        for (int index = 0; index < text.length() && count < MAX_LINE_CHARS; ) {
            int codePoint = text.codePointAt(index);
            index += Character.charCount(codePoint);
            if (isSpeakable(codePoint)) count += 1;
        }
        return count;
    }
}

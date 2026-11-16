# ARCore POC Follow-ups

> Non-blocking visual/tracking follow-ups from the first Samsung Galaxy Tab S8 smoke test. This is a native ARCore rendering proof of concept, not the production AR client.

## Verified on device

- Device: Samsung Galaxy Tab S8 Wi-Fi, `SM-X800`, Android 16 / API 36, Adreno 730, OpenGL ES 3.2.
- Camera background, horizontal plane hit-test, anchor creation and a green test cube were observed working.
- The user reports the anchor looks stable while moving the tablet.
- The cube remains composited in front when a real object occludes it. After brief occlusion, the anchor shifts slightly on relocalization; the user reports this is currently tolerable.
- There is no ARCore Depth API occlusion integration in this POC. The behavior is a known capability gap, not a release blocker for completing the core companion flow.

## Deferred

1. Measure anchor drift against a fixed tabletop ruler over a repeatable path; record p50/p95/max and test duration.
2. Evaluate ARCore Depth API or another licensed depth/occlusion approach. Keep virtual content visible when confidence/depth is unavailable; do not imply occlusion support before device testing.
3. Review apparent 7 cm test-cube scale at documented camera distances and choose a more useful visual marker size.
4. Recheck display rotation/crop across portrait/landscape and a second Android device.
5. Measure frame time, thermal state and memory after a 10-minute run.

## Non-goals of this POC

- No production voxel rendering, AR placement/relocalization controls, world networking, companion avatar, DSH/MCP adapter or release signing.
- No claim of cross-device compatibility from the Tab S8 result.

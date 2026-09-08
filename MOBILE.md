# Shipping Trap Chat to iOS and Android

The app is already an Expo React Native project. The identifiers exist
(`com.trapchat.app` on both stores), the icons exist, and the permission
strings for camera, microphone and location are written. What does not exist
is a native build, and the reason is specific: **seven files are web-only, and
they are the seven that make the product work.**

## What actually blocks a native build

`grep -rn "Platform.OS === 'web'" frontend/expo/src` returns seven files, and
every one of them returns nothing at all on native:

| File | What it does on web | What happens on native today |
|---|---|---|
| `webrtc.ts` | `RTCPeerConnection` | Refuses: "Video is only available in a browser" |
| `poseTracker.ts` | MediaPipe Pose via WASM | `poseSupported()` is false, so no rep or punch counting |
| `faceTracker.ts` | MediaPipe Face via WASM | No symmetry score, so Mog Off cannot be played |
| `VideoStage.tsx` | A DOM `<video>` element | Renders nothing |
| `RankedMatchScreen`, `ShadowBoxScreen`, `MogOffScreen` | DOM `<video>` for the camera | Renders nothing |

So a native build today would install, sign in, browse rooms and text chat —
and not do a single thing the app is actually for. That is the work, and it
is not small.

## The three replacements, in order of difficulty

**1. Video: `react-native-webrtc`.** A maintained library with the same API
shape as the browser's, so `webrtc.ts` mostly keeps its logic and swaps its
imports. The `<video>` elements become `<RTCView>`. This is the
best-understood of the three.

**2. Camera preview: `expo-camera`.** Replaces the DOM `<video>` in the three
match screens. Straightforward on its own; the difficulty is that the pose
model needs the *frames*, not just a preview.

**3. Pose and face: the real problem.** MediaPipe Tasks-Vision is a WASM
build meant for browsers. On native the options are:

- **`react-native-vision-camera` with a frame processor** plus a MediaPipe or
  TensorFlow Lite plugin. This is the standard answer and the one to plan
  for. It needs a config plugin and a native rebuild, so Expo Go is out from
  this point on — development builds only.
- **MLKit Pose Detection** via a community wrapper. Fewer landmarks than
  BlazePose's 33 but well supported on both platforms.
- **A WebView running the existing web code**, which would work today and
  would feel like what it is. Worth knowing as a fallback for a beta, not as
  the shipped product.

Whichever is chosen, `repCounter.ts`, `punchCounter.ts` and `faceScorer.ts`
do not change: they take landmarks and know nothing about where the landmarks
came from. That was the point of keeping them free of MediaPipe, and it is
what makes this migration a swap of one layer rather than a rewrite.

## The pipeline

Expo Application Services (EAS) is the path, and it fits the existing model —
push to deploy, no manual steps:

1. `eas.json` with `development`, `preview` and `production` profiles.
2. A `mobile CICD` workflow alongside the three that exist, triggering on
   `frontend/expo/**` and running `eas build --platform all --non-interactive`.
3. Credentials: `EXPO_TOKEN` as a repo secret. EAS can hold the signing keys
   for both stores, which avoids keeping a keystore in the repository.
4. `eas submit` for the stores, gated behind the same manual approval the
   infra plan uses. Store review is not something to trigger by accident.

**Cost.** EAS has a free tier with a build queue that is slow but real. Given
the pilot is deliberately free, start there and only pay when the wait becomes
the bottleneck.

## What the stores will ask that the web build never did

These are the things that fail review rather than fail to compile:

- **Permission strings** already exist in `app.config.ts`. Apple rejects
  vague ones; ours name what the camera and microphone are for.
- **Account deletion.** Apple requires an in-app way to delete an account for
  any app that lets you make one. There is no delete endpoint today. This is
  a hard requirement, not a nice-to-have.
- **A privacy policy URL**, reachable and specific about the camera. Worth
  saying plainly that pose and face detection run on the device and no frames
  are uploaded, because it is true and it is unusual.
- **Age rating.** Random video chat with strangers will be rated 17+, and
  both stores look closely at apps in that category.
- **Moderation and reporting.** Apple's guideline 1.2 requires a way to report
  abusive users and a way to block them for any app with user-generated
  content. Random video chat is exactly the category they enforce this on.
  There is no report or block feature today. **This will block review**, and
  it is the largest missing piece after the pose work.

## Honest order of work

1. Report and block, plus account deletion. Nothing ships without these, and
   they are useful on the web build too.
2. `react-native-webrtc` and `expo-camera`, giving a native build that can do
   social chat.
3. Frame-processor pose detection, giving back the competitive games.
4. EAS pipeline and store submission.

Steps 1 and 2 are well-trodden. Step 3 is the one to estimate carefully and
the one most likely to need a spike before committing to a date.

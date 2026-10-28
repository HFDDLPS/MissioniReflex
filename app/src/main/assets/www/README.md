# Missioni Reflex — Field Play MVP v8

Missioni Reflex is an Android/Capacitor photography-learning game built around an interactive 3D Pentax K1000 model. This version preserves the existing 3D scene and photo-review flow and improves the learning path, chapter progression, review rubric, wardrobe rewards and first-use tutorials.

## New in v8

- Replaced the prototype hat, scarf and strap geometries with the three supplied GLB models, bundled locally in the Android assets.
- One cosmetic slot only: selecting hat, scarf or moka replaces the previous item; “Nessun accessorio” clears the slot.
- Hat is fitted above the Pentax prism, scarf is fitted around the camera body, and the moka keeps its proportions and sits beside the camera. A wider home frame is used while the moka is equipped.
- Demo mode exposes all three cosmetics; Supabase mode unlocks them by chapter and the schema migrates the previous cosmetic IDs to “none”.

## New in v7

- When a mission label is tapped, the camera now completes the 3D move/zoom first; only after the animation finishes does the mission detail panel fade in. The navigation controls are temporarily disabled during the movement to keep the transition uninterrupted. Closing or cancelling while opening invalidates the pending reveal safely.
- The 3D view is framed for the mission sheet during the transition, and returns to the home framing when the mission is closed.

## New in v6

- 12 concise photo missions in three suggested chapters: **Composizione** (4), **Luce** (4), **Tecnica** (4).
- The 3 chapter filters show only four camera-anchored labels at once, avoiding a cluttered 12-label map. Mission display order is pedagogical; database IDs 1, 2 and 3 retain their original meanings for backward compatibility.
- Each mission contains a practical single-photo goal, an optional hint and visible review criteria. The same criteria appear in the admin review queue, helping a non-specialist apply consistent decisions.
- The rullino now has 12 individual frames and chapter progress meters. Only reviewer-approved missions develop a frame.
- Contextual one-time guidance: first visit to the camera map, first accepted mission, and first opening of the wardrobe. Tips are remembered per user on the device and queued to avoid replacing one another.
- The test/demo mode keeps all cosmetics available. In a configured non-demo backend, the hat unlocks after all Composizione missions are approved, the scarf after Luce, and the moka after Tecnica.
- Supabase SQL constraints and `start_mission` RPC now support mission IDs 1–12. Existing IDs 1–3 are preserved; rerun the included schema in the Supabase SQL Editor to apply the idempotent constraint migration.

## Curriculum design

The sequence prioritizes composition and light because users can practice them with almost any phone camera. Technical exposure concepts follow once the player has learned to identify a subject and control the visual intent. For aperture, shutter speed and ISO, tasks focus on visible effects and include a phone-friendly alternative when manual control is unavailable.

The curriculum is informed by the concept-based beginner tutorials at Cambridge in Colour. Its tutorial library covers composition (rule of thirds and negative space), natural light, depth of field, autofocus and the exposure triangle:
- https://www.cambridgeincolour.com/tutorials.htm
- https://www.cambridgeincolour.com/tutorials/camera-exposure.htm
- https://www.cambridgeincolour.com/photography-techniques.htm

The app uses those topics to build short practice prompts. It does not reproduce source tutorial text; mission instructions are newly written for the app.

## Demo mode

`app/src/main/assets/www/supabase-config.js` defaults to `demoMode: true`. Test accounts, progress and submissions are local to one device/WebView. Use the demo admin code configured there to test review; do not use demo authentication for a public release.

## Supabase mode

1. Create a Supabase project.
2. Run `supabase-schema.sql` in the SQL Editor. The script creates tables, RLS policies, the private `mission-photos` bucket and upgrades the accepted mission ID range to 1–12.
3. Configure `supabase-config.js` with the project URL and anon/publishable key and set `demoMode: false`. Never place a service-role key in the app.
4. Create an account, then promote the reviewer profile to `role='admin'` through the SQL Editor.

Existing mission IDs 1–3 retain their meanings (aperture, focus, shutter speed). New IDs 4–12 are inserted without renumbering them; the interface uses a separate display order for the recommended curriculum.

## Build

Open `MissioniReflexAndroid` in Android Studio. Use JDK 17 and Android SDK Platform 36, sync Gradle, then run on an emulator/device. To build a debug APK:
- Windows: `gradlew.bat assembleDebug`
- macOS/Linux: `./gradlew assembleDebug`

## Known limitations

- The existing 3D model, native camera/gallery selector and human review workflow are preserved from v5; test them on the target Android device after this update.
- No APK was compiled by this patching environment; local Gradle/network setup is required for a release build.
- Chapter completion uses approved mission statuses; test mode leaves all cosmetics unlocked by design.
- The review criteria make moderation more consistent but do not replace artistic judgement. For public use, pilot the rubric with multiple reviewers and refine it based on disagreements.
- Chapter tabs show four mission labels at a time. When changing chapters while a mission panel is open, the panel is closed before the new set of labels appears.

## Model credit

“ASAHI PENTAX K1000” by LOOWIE on Sketchfab, CC BY 4.0: https://sketchfab.com/3d-models/asahi-pentax-k1000-0e342ea75d9745fdb213658856d69dab . Keep the attribution with all distributions.





## Cosmetic GLB assets

The following user-supplied models are packaged locally under `app/src/main/assets/www/models/cosmetics/`:
- `HatModificato.glb` — fitted above the camera prism.
- `scarf_soccer_-_tf2.glb` — non-uniformly fitted around the camera body with clearance around the outer body bounds.
- `moka_pot.glb` — uniformly scaled to nearly the camera's height and positioned beside it.

Only one item can be equipped. Selecting a different item replaces the previous one; `Nessun accessorio` clears the slot. In demo mode all are available. In Supabase mode the hat, scarf and moka are rewards for completing Composizione, Luce and Tecnica respectively. The model fits are based on GLB bounding boxes and should be visually checked on the target Android device before release.


### Cosmetici 3D (v9)
- L'accessorio attivo occupa un solo slot; i gruppi 3D residui vengono rimossi prima di applicarne uno nuovo.
- `HatModificato.glb` è stato ripulito: nella scena attiva resta solo il ramo del cappello. Il file originale conteneva anche una fotocamera e una sciarpa come radici separate, che venivano caricate insieme al cappello.
- La moka è collocata leggermente più avanti e l'inquadratura si allarga in verticale per mantenerla visibile accanto alla fotocamera.

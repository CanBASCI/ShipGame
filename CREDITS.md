# Credits

These files are stored in the repo and loaded by the scene.

## Weathered Planks

- Author: Dimitrios Savva (photography), Dario Barresi (processing)
- License: CC0
- Source: https://polyhaven.com/a/weathered_planks
- Files: `public/assets/wood/weathered_planks_diff_1k.jpg`, `weathered_planks_nor_gl_1k.jpg`, `weathered_planks_rough_1k.jpg`
- Use: wood grain on the rowboat hull and oars. The maps are applied to generated box UVs; the boat mesh itself is the Simple Wood Boat below.

## Simple Wood Boat

- Author: mikeask
- License: CC0
- Source: https://opengameart.org/content/simple-wood-boat
- File: `public/assets/boat/rowboat.glb`
- Use: the player's wooden rowboat. Hull and seat come from mikeask's `woodBoat.blend` (body + division), scaled to about 3.6m with the bow pointing down the canal. The single paddle mesh was split into a left oar and a right oar, each pivoted at the gunwale. Box UVs were added so the weathered-planks texture reads on the wood. The dark rower and the warm hanging lamp are not part of that file. It stays available as Mevcut on the tune panel.

## Old Boat

- Author: donnichols (https://sketchfab.com/donnichols)
- License: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Source: https://sketchfab.com/3d-models/old-boat-a9ce4ca0cac14f448c72bb94ad193437
- Files: `public/assets/boat/donnichols/scene.gltf`, `public/assets/boat/donnichols/scene.bin`, `public/assets/boat/donnichols/textures/Main_baseColor.jpeg`, `public/assets/boat/donnichols/textures/Main_metallicRoughness.png`, `public/assets/boat/donnichols/textures/Main_normal.jpeg`
- Use: the boat the game opens on (Donnichols on the tune panel). The hull and its two oars are that model, scaled to the same length as the mikeask boat with the beam narrowed so it sits on the canal the same way. The bow lantern is not part of that file.
- This work is based on "Old Boat" (https://sketchfab.com/3d-models/old-boat-a9ce4ca0cac14f448c72bb94ad193437) by donnichols (https://sketchfab.com/donnichols) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

## Sakura tree

- Author: Jagobo
- License: CC-BY 4.0
- Source: https://sketchfab.com/3d-models/cherry-blossom-trees-f69be55d2e4f4f73b568ebb185bd8496
- File: `public/assets/trees/sakura.glb`
- Use: every bank tree. The file is Jagobo's "Cherry Blossom Trees" model: three trees with photographic bark and blossom textures. Each tree was scaled so the trunk is about 5.4m with roots at the origin. The foliage cards were kept whole so the blossom photo stays intact. In the night scene the crown is lit from that photo, with only a slight cool shift on the left bank and a slight warm shift on the right. This work is based on "Cherry Blossom Trees" (https://sketchfab.com/3d-models/cherry-blossom-trees-f69be55d2e4f4f73b568ebb185bd8496) by Jagobo (https://sketchfab.com/Jagobo) licensed under CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/).

## Canal water ripples

- Author: ambientCG
- License: CC0
- Source: https://ambientcg.com/a/Foam001
- Files: `public/assets/water/Foam001_NormalGL.jpg`, `Foam001_Roughness.jpg`
- Use: fine ripple normal on the dark canal. The sea material supplies the water color and roughness. The foam color and roughness maps are not used.

## Sea part

- Author: Ayberk Tosunoglu (https://sketchfab.com/aybush)
- License: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Source: https://sketchfab.com/3d-models/sea-part-e90b3547e64a4bbd825fd126760f1770
- Files: `public/assets/water/sea_part/scene.gltf`, `public/assets/water/sea_part/scene.bin`
- Use: the canal surface the boat rides on. The patch is widened to the canal and repeated along it. The crests sit on the waterline so the hull is not buried. The water keeps this model's Plane color: base about (0.00735, 0.00553, 0.01596), metal about 0.581, roughness about 0.069. Lantern reflections and the moon streak sit on that color.
- This work is based on "Sea part" (https://sketchfab.com/3d-models/sea-part-e90b3547e64a4bbd825fd126760f1770) by Ayberk Tosunoglu (https://sketchfab.com/aybush) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

## Bamboo veneer

- Author: Jenelle van Heerden
- License: CC0
- Source: https://polyhaven.com/a/bamboo_veneer
- Files: `public/assets/bamboo/bamboo_veneer_diff_1k.jpg`, `bamboo_veneer_nor_gl_1k.jpg`, `bamboo_veneer_rough_1k.jpg`
- Use: bamboo ribs, post, and caps on the lantern model

## Creased paper

- Author: ambientCG
- License: CC0
- Source: https://ambientcg.com/a/Paper003
- Files: `public/assets/paper/Paper003_Color.jpg`, `Paper003_NormalGL.jpg`, `Paper003_Roughness.jpg`
- Use: paper panels of the bamboo lanterns, tinted yellow, pink, purple, cyan, orange, and white

## Brass lantern

- File: `public/assets/lantern/Lantern_01_1k.gltf`
- Use: the warm hanging lamp on the bow of the boat. No post. The banks do not use this mesh.

## Full moon

- Author: Sivaln
- License: CC0
- Source: https://commons.wikimedia.org/wiki/File:Full_moon_on_24_February_2011.jpg
- File: `public/assets/moon/full-moon.png`
- Use: the full moon above the canal centerline. The photograph is Sivaln's "Full moon on 24 February 2011". The black sky around the disc was made transparent so the photo can sit in the night sky. It is not a drawn circle.

## Night-sky star

- Author: Kenney
- License: CC0
- Source: https://www.kenney.nl/assets/particle-pack
- File: `public/assets/stars/star.png`
- Use: the stars in the night sky. This is `star_07.png` from Kenney's Particle Pack, a soft white star with a transparent background. It is stamped into the sky so the night points stay soft stars, not square cells.

## Distance mist

- Author: WickedInsignia
- License: CC0
- Source: https://opengameart.org/content/clouds-with-transparency
- Files: `public/assets/fog/mist-a.png`, `public/assets/fog/mist-b.png`, `public/assets/fog/mist-c.png`
- Use: the night distance mist. These are `FX_CloudAlpha02`, `FX_CloudAlpha04`, and `FX_CloudAlpha07` from WickedInsignia's "Clouds with Transparency", resized to 1024. Wide overlapping cards sit in the world across the canal and both banks. The mist stays clear by the boat, fades in farther ahead, and keeps going down the canal. Moonlight and the bow lantern are what show it.

## Ghost Daughter

- Author: LostBoyz2078 (https://sketchfab.com/LostModels2025)
- License: CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/)
- Source: https://sketchfab.com/3d-models/ghost-daughter-89850ac12e0f468582d4d0dcebd4efbc
- Files: `public/assets/obstacles/ghost_daughter/scene.gltf`, `scene.bin`, `license.txt`, and `textures/`
- Use: the first Arcade obstacle. Copies stand on the water in the lanes ahead of the boat, play the model's own clip in place, and turn to face the bow lantern. Arcade off does not show them.
- This work is based on "Ghost Daughter" (https://sketchfab.com/3d-models/ghost-daughter-89850ac12e0f468582d4d0dcebd4efbc) by LostBoyz2078 (https://sketchfab.com/LostModels2025) licensed under CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/).

## Ghost

- Author: kira.is.real (https://sketchfab.com/jadeisreal0615)
- License: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Source: https://sketchfab.com/3d-models/ghost-4e71afbfee0047768ed0ddb3982d9887
- Files: `public/assets/obstacles/ghost_blood/scene.gltf`, `scene.bin`, `license.txt`, and `textures/`
- Use: an Arcade obstacle mixed with the ghost daughter and the rock. Copies stand on the water in the lanes. This model has no clip and no lantern mesh. A red light inside the cloak lights only this ghost. About half of them, chosen when they spawn, fly into an empty lane. The flight starts at 20 m and lasts 2 seconds: they turn toward that lane as they move, rise and lean head-first through the middle, then land upright and follow the bow lantern. The rest keep the heading they spawned with. Arcade off does not show them.
- This work is based on "Ghost" (https://sketchfab.com/3d-models/ghost-4e71afbfee0047768ed0ddb3982d9887) by kira.is.real (https://sketchfab.com/jadeisreal0615) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

## Rock

- Author: Siesta (https://sketchfab.com/siesta)
- License: CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Source: https://sketchfab.com/3d-models/rock-b66d5b63deb447299ca3effa904bc789
- Files: `public/assets/obstacles/rock/scene.gltf`, `scene.bin`, `license.txt`, and `textures/`
- Use: an Arcade obstacle mixed with the ghosts. Copies sit frozen on the water in the lanes. They do not turn. Arcade off does not show them.
- This work is based on "Rock" (https://sketchfab.com/3d-models/rock-b66d5b63deb447299ca3effa904bc789) by Siesta (https://sketchfab.com/siesta) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

## Bamboo lantern

- File: `public/assets/lantern/bamboo_lantern.glb`
- Use: hexagonal bamboo-and-paper lanterns on posts along the canal. The frame uses the bamboo veneer above. The shade uses the paper maps above.

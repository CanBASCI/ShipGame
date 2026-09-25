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
- Use: the player's wooden rowboat. Hull and seat come from mikeask's `woodBoat.blend` (body + division), scaled to about 3.6m with the bow pointing down the canal. The single paddle mesh was split into a left oar and a right oar, each pivoted at the gunwale. Box UVs were added so the weathered-planks texture reads on the wood. The dark rower and the warm hanging lamp are not part of that file.

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
- Use: fine ripple normal and roughness on the dark canal. Lantern and blossom reflections stay in the water shader. The foam color map is not used.

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

## Bat

- Author: MoikMellah
- License: CC0
- Source: https://opengameart.org/content/bat-32x32
- File: `public/assets/bats/bat.png`
- Use: the bats in the distance mist. This is the gray flight cycle from MoikMellah's 32×32 bat, five wing frames kept and the magenta backdrop removed. A few at a time cross or follow the canal inside the fog ahead of the boat, then leave. They are not on the camera, the boat, or the water.

## Bamboo lantern

- File: `public/assets/lantern/bamboo_lantern.glb`
- Use: hexagonal bamboo-and-paper lanterns on posts along the canal. The frame uses the bamboo veneer above. The shade uses the paper maps above.

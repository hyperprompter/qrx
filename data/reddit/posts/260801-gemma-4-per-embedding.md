whoo! i was able to reproduce this experiment, it might literally be the easiest end-to-end workflow for training a (tiny) LLM i have ever tried: https://github.com/slvDev/esp32-ai

the r/esp32 S3 only has 512KB SRAM, 8MB PSRAM and 16MB flash but this project uses Gemma 4's Per-Layer Emebeddings to split the model across them

basically it works by separating out the embedding table in flash memory (since it's mostly just a lookup table) while keeping the cognitive core in RAM

the reason i made the LLM OS kernel isn't reaaaally to use it as a desktop operating system but rather as a knew kind of generative mesh networking protocol inspired by Plan9's everything-is-a-file model: https://9p.io/plan9/screenshot.html

normally with Long Range (LoRa) radio you can only mesh network over miles very very OMFG SO VERY slowly...BUT! because prompts are a kind of semantic compression you can mesh intent instead of pure data

which is a-ok for what we're explore!

next step is to actually 3d print the binder housing, and put all this stuff into it...the goal is to create a 3D-printed grimoire! check out what i mean in this other post which i talk about here: https://www.reddit.com/r/Hyperprompting/comments/1vcr5he/what_would_physical_hypertext_look_like/
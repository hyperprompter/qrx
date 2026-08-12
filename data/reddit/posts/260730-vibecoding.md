I've been working on a vibe coding system that uses hyperlinks as prompts to allow tiny models to generate complex apps using prompt-chains
It works by inverting the browser so that the Address Bar becomes a prompt interface and the indexedDB becomes the "server"
I'm doing this bc hyperlinks can be encoded into QR Codes which can be scanned from most devices with just the default camera app and can be distributed literally on paper
It's not reaaally about QR Codes but about "links that click themselves" in the Cybernetic sense, it just so happens that you can encode hyperlinks into scannable QRs
One benefit of using prompt-hyperlinks is that they semantically compress huge amounts of data in tiny strings, which can be transmitted over bluetooth or LoRa radio on cheap ESP32's
The LLM OS kernel is isomorphic - this means it works in the browser, in the terminal, even inside Reddit itself. Warning: it's fugly && buggy inside Reddit but click around that's not an image!
https://www.reddit.com/r/Hyperprompting/comments/1uenrfs/devlog_towards_a_social_operating_system/
I explain the theory behind this in extreme detail here:
https://www.reddit.com/r/Hyperprompting/comments/1ulprhb/hyperprompting_kernel_v260702_getting_started/
There is an even more cursed version of this that uses Data URIs, which tricks the browser into creating a true "serverless" generative app (you still need to hit an LLM with API). This technique works in browsers as old as the 90s:
https://www.reddit.com/r/Hyperprompting/comments/1uc5rgm/tutorial_how_to_llmwrap_serverless_hyperlinks_qr/
The system itself is a true Quine, that means it can generate itself from inside itself! It does this by using iframes that point back to itself. The grand ultimate goal is to explore "Autopoietic Hypertext" which is hypertext that generates itself
Over the years I've built up a dataset of these "hyperprompts" including:
Chat
Agents
Reddit RSS reader
and a mesh networking protocol
This system isn't reaaaally meant for humans to type (it's too convoluted) but for agents to type so that you can say "make me a paint app" and it generates a clickable/sharable hyperprompt (since all hyperprompts are valid hyperlinks)
My next major step is to finetune Gemma on the dataset, so that it can "weave itself through hypertext". You can read why I'm even doing any of this on the pinned post @ r/Hyperprompting but it's way too escoteric to explain here haha
(the sub is not really public bc I'm too lazy to moderate; it's more of a place to share everything so you don't have to leave Reddit or subscribe to anything like a substack)
The repo is here: https://github.com/hyperprompter/qrx
~~~~~
TLDR: I made an extremely convoluted way to vibe code using paper
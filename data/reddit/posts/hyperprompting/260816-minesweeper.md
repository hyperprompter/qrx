---
title: Minesweeper made by Hyperprompting (it's interactive; see comments!)
subreddit: r/hyperprompting
flair: Demo
media:
    - interactive Devvit App of Minesweeper game
source: https://www.reddit.com/r/Hyperprompting/comments/1vq06sc/minesweeper_made_by_hyperprompting_its/
---

<comments>
u/hyperprompter avatar
hyperprompter
OP
•
4h ago
HUZZAH!

it took 2 months to get this far but here is the first interactive demo of the Reddit port of the Hyperprompting kernel, which you can learn about here:

https://www.reddit.com/r/Hyperprompting/comments/1ulprhb/hyperprompting_kernel_v260702_getting_started/

the hyperprompt i used to make this inside of reddit was just

#apps/minesweeper?e&w&p=Build a fully working minesweeper app&w
and that's it! look at how simple that is :D

it works because the URL is treated as a "machine tape" and the URL itself is sent the the LLM as context

so the model (i used Claude Sonnet 4.6):

sees #apps/minesweeper

and the ?p prompt tells it to "Build a fully working minesweeper app"

?e&w is just a shorthand to clear out any existing data at that hash, otherwise the value of the hash gets fed into the machine tapes accumalator and the model would assume the prompt is asking to ADD to the existing data instead of starting fresh

this is one of the simplests examples i could get to work inside of Reddit. now that i know the system works inside here we can ramp this subreddit waaaaay up

it's going to be so much fun! by the way you can close the window and explore the rest of the LLM OS, which we will be doing over time. eventually you'll be able to create your own hyperprompts to try this protocol yourselves hands on without leaving Reddit

by the way this is what it looks like when Gemma 4 26B A4B tried it
</comments>

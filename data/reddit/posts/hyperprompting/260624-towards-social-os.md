---
title: [Devlog] Towards a Social Operating System
subreddit: hyperprompting
flair: Demo
media:
    - APP win9x desktop hyperprompting simulator with welcome window
source: https://www.reddit.com/r/Hyperprompting/comments/1uenrfs/devlog_towards_a_social_operating_system/
---

<comments>
u/hyperprompter avatar
hyperprompter
OP
•
1mo ago
•
Edited 1mo ago
Update 260704
progress has felt slow this week bc there are so many moving parts...there's the subreddit itself, the github repository, the ongoing research and all the writing that comes with it, and also i just started a new r/BG3 campain

there's no engagement yet which is expected since i haven't announced the subreddit yet (in fact the sub is in restricted/read-only mode right now anyways), but im very surprised how many views these posts are getting (each post has hundreds of views, the pinned one has 1k)

there's a kind of pressure to start sharing the LLM OS on other subs but i really want to hyperstition the project without telling people directly. i definitely lose a lot of alpha this way (the kernel idea is "simple" in hindsight so anyone can easily scoop me) but im trying to detach myself from the work to encourage future communities to take the work seriously independent of big tech and the impulse to monetize this somehow

anyways!

The Subreddit
if you look in the prompts folder above you'll see a few dozen hyperprompts i've already prepared. the goal is to create a standalone (interactive) post for each hyperprompt, so you can actually try it without leaving reddit

one of the research north stars for this sub is to get hyperprompts to work with LLMs small enough to run locally in the browser, so you can run inference here also without leaving the app...im kind of obsessed with flexing the kernel's isomorphism and my bet is that once i can sufficiently explain this project we can FOOM the LLM OS

this week we did the following:

started the sub's Wiki (kinda slim rn tho) https://www.reddit.com/r/Hyperprompting/wiki/index/

published the kernel's first getting started post...this is gonna take a few iterations to articulate clearly: https://www.reddit.com/r/Hyperprompting/comments/1ulprhb/hyperprompting_kernel_v260702_getting_started/

started a new Post Flair for resharing related #Hypertext projects and inspiration since there are so many uses and ways to integrate hyperprompting

Towards Next Week
the idea is to pin this interactive post to the sub and have it automatically update itself based on the subs content. the above demo is too boring still and looks like a static image even tho it's actually an interactive app!

i'll also be increasing the post pacing from 2-3 a week to daily (if possible), though im not sure im ready to start announcing this subreddit yet (im kinda anxious about moderating a subreddit tbh haha)

anways here's a screenshot of my actual desktop with custom wallpapers, a graph visualizer, and recursive windows (the system can load itself from inside itself!)

Comment Image
Edit 1: expanded intro to explain why i haven't announced this sub or shared any of these projects outside of this yet


Upvote
1

Downvote

Reply

Share

26

u/hyperprompter
Approved 1 month ago

Moderation actions menu
u/hyperprompter avatar
hyperprompter
OP
•
2mo ago
Update: 260627 0858

im still maintaining this devlog! i haven't updated in 3 days because I ran into a roadblock where we can only use APIs from very specific endpoints (almost nowhere except OpenAI and Gemini endpoints)

the original vision was to add an agentic Clippy, as I did on r/Websim in 2024 which helped kickstart the OS simulator frenzy. indeed it's the fact that even after kickstarting this frenzy that very few people have mastered recursing hyperlinks that inspired me to start this sub:


keep in mind this was in 2024! in this demo im having Clippy (via Clippy.js) "computer use" a Windows 95 emulation through the Windows 95 simulator to type into Notepad from outside the emulation

fortunately Google has a "startup" program you can sign up for where they will give you $2k in cloud credits to build out an MVP and up to $250k once you start getting seed funding (tho i wont be pursuing that): https://cloud.google.com/startup

so for now you won't be able to generate or chat within the app while on Reddit (ofc if you download the source you can use anything you want: https://github.com/hyperprompter/qrx ) but that's ok bc i haven't even officially announced this subreddit yet

anyways i'll try to update more regularly! im building everyday it's just that im out of practice with social media (i started r/nosurf sometime around 2024 and completely disconnected most of the past year). once im able to explain recursive hyperlinks a bit clearer this sub should pop off and i will have lots of content and things for you to try :D


Upvote
1

Downvote

Reply

Share

22

u/hyperprompter
Approved 2 months ago

Moderation actions menu
u/hyperprompter avatar
hyperprompter
OP
•
2mo ago
HUZZAH!!!

the above represents a live preview of one of the first ever socially hyperprompted LLM Operating Systems

the way this will work is that anyone can contribute a filename, and the filename with the most upvotes becomes the canonical file in the Operating System (OS). this is inspired by "sensemaking theory" in r/Cybernetics which is currently best represented (at least imo) by the r/ATProtocol on r/BlueskySocial

think of this as a "vibe coding interface for Egregores": https://www.reddit.com/r/occult/comments/1cz34xq/egregores_what_are_they/

this system is read only right now so you can click the icons and play around, but the AI is not yet hooked up and there is no persistence. it will be very buggy for a while...

it uses an isomorphic kernel that treats the browser as a virtual machine...it's similar to r/TempleOS_Official but instead of running inside QEMU you run it inside the browser. the source code is on github: https://github.com/hyperprompter/qrx

each environment runs the same kernel but with different bootloaders specific to that environment; so far i have gotten this kernel to work on Reddit, r/esp32's, smart tv's and projectors with web browsers, smart watches, and of course desktop/mobile browsers

this entire project was generated from a single seed qr code which you can find in the sidebar of this subreddit

i'll be using this post as a devlog for the reddit app, so make sure to follow this post if you want regular updates. also don't forget to subscribe to r/hyperprompting for deeper dives into the theories and applications around LLM OS's
</comment>

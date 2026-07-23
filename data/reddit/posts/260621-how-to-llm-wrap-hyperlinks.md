# [Tutorial] How to LLM-wrap "Serverless" Hyperlinks && QR Codes
https://www.reddit.com/r/Hyperprompting/comments/1uc5rgm/tutorial_how_to_llmwrap_serverless_hyperlinks_qr/

<media>
#1 - some of these techniques have been possible in web browsers as early as 1990s
#2 - example of a physics simulation with Qwen 3
#3 - Example of a chatbot which can itself generate executable code inline
#4 - Various zines I've made with generative Data URIs, the front one generates a digital rain
</media>

<body>
in this tutorial you will learn how to create dependency-less, single-scan generative tools and web apps that you can encode into qrcodes or share as clickable links on your website, blogs, etc

these qrcodes do not require a server to host them...they do not take you somewhere like most qrcodes, rather they ***generate*** ephemeral, sandboxed environments for you to vibe code in

the goal is to provide the foundational background needed to understand r/hyperprompting and autopoietic hypertext in general (eg links that "click themselves")

# Background

**Data URIs** are special links that run code instead of navigating hypertext. they have been available in browsers since at least the 90s and take the following shape:

    data:text/html,<script>alert('hello world')</script>

the first part

`data:text/html,`

tells the browser to render everything after as HTML. to run javascript you wrap it with `<script>` as you would any other web app

most browser APIs are disabled by the Data URI protocol; there's no indexedDB, no web bluetooth, no webcam or microphone, or device sensors. what you DO you have is `fetch()` which lets you use APIs provided by other servers and endpoints

for example, instead of showing a "Hello World" message like the above example, you could fetch a random Wikipedia page summary:

    data:text/html,<script>fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary').then(r=>r.json()).then(d=>alert(d.title+'\n\n'+d.extract)).catch(e=>alert('Error: '+e));</script>

if you copy/paste the above into a desktop browser you will get an alert box with a random post title and summary!

note that this only works on desktop browsers by default, for security reasons mobile devices tend to disable the Data URI protocol

# Ollama Template - Starfield Animation

the following should work with a local r/ollama LLM setup with CORS disabled. replace `model` with the model you use and `0.0.0.0` with your machines IP. this works best in r/firefox, chromium browsers can require further config changes

    data:text/html,<body></body><script>(async()=>{const p="TASK: output HTML including CANVAS and SCRIPT tag that draws dense canvas starfield animation. overlayed ontop is a scrolling poem star wars style about the genesis of the dataverse. NO TALKING NO MARKDOWN DO NOT ACKNOWLEDGE BEGIN RAW OUTPUT NOW:";document.body.innerHTML="<h1>Generating starfield animation... Please Stand By...</h1>";const r=await fetch("http://0.0.0.0:11434/api/generate",{method:"POST",body:JSON.stringify({model:"qwen3.5:4b-q4_K_M",prompt:p,stream:false})});const j=await r.json();const response=j.response;document.open();document.write(response);document.close()})()</script>

# Use Cases

the core idea is that generative Data URIs can semantically compress massive projects. beyond that here are some other ideas:

* **project ideas**
   * generative RSS and news readers
   * chatbots, agents, and vibe coding interfaces
   * "serverless" dashboards where each link is a generative tool
* **distribution**
   * paper qrcodes
   * qrcode stickers
   * HTML anchor tags with `target=_blank`

# More to Come

this tutorial only covers the Data URI protocol, but there are many other protocols we'll be visiting like the `file:// protocol` which grants some browser APIs like localStorage and indexedDB, `javascript:// protocol` for bookmarklets, and ofc the standard `HTTP protocol` we use to browse the web

in future tutorials we'll discuss techniques for persistence, memory management, creating multi-hop Data URIs and Data URI Factories (URIs that generate URIs), swarms and more

leave any questions, thoughts, comments, or share your own generative Data URIs below!
</body>
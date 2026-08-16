previously we explored "serverless" generative Data URI-based hyperlinks: [https://www.reddit.com/r/Hyperprompting/comments/1uc5rgm/tutorial\_how\_to\_llmwrap\_serverless\_hyperlinks\_qr/](https://www.reddit.com/r/Hyperprompting/comments/1uc5rgm/tutorial_how_to_llmwrap_serverless_hyperlinks_qr/)

however Data URIs run in a highly sandboxed environment lacking many browser APIs including local storage persistence...for that we need an actual HTML file that can be opened in a browser

in this post i'll share the kernel source code, how to install it, and some basic hyperprompting techniques

the kernel and hyperprompts for the screenshots above are hosted on [https://github.com/hyperprompter/qrx](https://github.com/hyperprompter/qrx)

# The Kernel

here is the uncompressed, hand-optimized source code

to install it, copy+paste this into a .html file and then open that file in the browser. because this is just a kernel you will get a blank page on initial load, the rest of this post explains how to prompt it

    <main id=A></main>
    <script id=S>
    BASE = ''
    setTimeout(async () => {
      // manually compressed shorthands
      L = location
      LP = L.pathname
      $L = localStorage
      G = 'globals'
      C = 'cache'
      T = 'target'
      TL = 'toLowerCase'
      RO = 'readonly'
      HR=history.replaceState.bind(history)
    
      // default indexedDB name
      WNS = await window.NS
      filename = MAIN = 'main'
      DB = (LP.startsWith(BASE) ? LP.slice(BASE.length) : LP).replace(/^\/|\/$/g, '') || WNS || MAIN
    
      // default table name
      FILES = 'files'
    
      os = db = null
    
      // promise wrapper around DB transactions
      // q: the request
      // f: optionall callback to transform result
      queryDB = (q, f) =>
        new Promise(r => q['onsuccess'] = e => r(f ? f(e) : e[T].result))
    
      // n: database name
      // t: table name
      getDB = (n = DB, t = FILES) => {
        let q = indexedDB.open(n)
        q.onupgradeneeded = e => e[T].result.createObjectStore(t)
        return queryDB(q, e => e[T].result)
      }
    
      // returns all keys in database
      // q: query
      // d: database
      keys = (q, d) => queryDB(tx(RO, d).getAllKeys(q))
    
      // db transaction
      // m: transaction mode
      // d: database
      tx = (m = RO, d = db, t = FILES) => d.transaction(t, m).objectStore(t)
      write=async(v,k,d=db,n=filename)=>(d=d.trim?await getDB(d):d,queryDB(tx('readwrite',d).put(v,k||n)))
      read = async (k, d = db) => {
        d = d.trim ? await getDB(d) : d
        let v = await queryDB(tx(RO, d).get(k || filename))
        return !v && d == db && os ? read(k, os) : v
      }
    
      // db init
      boot = async () => {
        db = await getDB()
        os = DB[TL]() == MAIN[TL]() ? null : await getDB(MAIN)
      }
    
      // run the os
      run = async () => {
        if (!db) await boot()
        if (!L.hash) {
          HR(0, '', `#${MAIN}`)
          return run()
        }
        let c, ctx, h = L.hash.slice(1),
          [n, q] = h.split('?'),
          f = filename = n,
          v = await read(n) || '',
          app = false // append mode
        if (!q && $L._q) { let t = $L._q.split('?'); t[0] == n && t[1] && (q = t[1], $L._q = '') }
        let p = new URLSearchParams(q)
    
        // run boot/* files on every navigation, filename is already set
        let bq = IDBKeyRange.bound('boot', 'boot\uffff'),
          b = await keys(bq, db)
        if (os) b = [...new Set([...b, ...await keys(bq, os)])]
        for (let bf of b) {
          try { (new Function(G, await read(bf)))(this) }
          catch (e) { console.error(bf, e) }
        }
    
        // The Machine Tape
        for (let [k, val] of p) {
          val = decodeURIComponent(val)
          let r, s
          // should we overwrite (0) or append (1)
          if (k == 'a') app = val != '0'
          // file pointer
          else if (k == 'f') f = val
          // additional context buffer for ai only (does not get added to accumalator)
          else if (k == 'c') {
            if (val == '0') ctx = ''
            else ctx = `<CONTEXT>${(ctx || '')}</CONTEXT>
      ${((val == 'src' ? S.innerText : await read(val)) || '')}`
          }
          // ai variables
          else if ('kmsh'.includes(k)) $L.setItem(k, val)
          // accumalator commands (including prompting)
          else if ('erup'.includes(k)) {
            s = val
            if (k == 'r') s = (val == 'src' ? S.innerText : await read(val)) || ''
            else if (k == 'u') {
              try {
                s = await (await fetch(val)).text()
                await write(s, val, C)
              } catch (e) {
                s = await read(val, C) || e
              }
            }
            else if (k == 'p') s = await gen((ctx ? ctx + '\n' : '') + v, val)
            v = app ? v + s : s
          }
          // write accumalator to disk
          else if (k == 'w') await write(v, f)
          // execute code
          else if (k == 'x') {
            try {
              let c = val || v
              r = await (new Function(G, 'v', c))(this, v)
              if (r !== void 0) v = r
            } catch (e) { console.error(e) }
          }
          // autoload other params
          else if (c = await read(k)) {
            try {
              r = await (new Function(G, 'v', 'arg', c))(this, v, val)
              if (r !== void 0) v = r
            } catch (e) { v = app ? v + c : c }
          }
        }
        if (q) { v ? ($L._q = '', HR(0, '', '#' + n)) : ($L._q = n + '?' + q, HR(0, '', '#' + n)) }
        hydrate(v)
      }
    
      // inject content into DOM and run scripts
      // h: html content to inject
      hydrate = h => {
        A.innerHTML = h
        A.querySelectorAll('script').forEach(o => {
          let s = document.createElement('script')
          Array.from(o.attributes).forEach(a => s.setAttribute(a.name, a.value))
          s.text = o.textContent
          o.replaceWith(s)
        })
      }
    
      // get a generative response from ?h
      // ctx: extra context
      // p: the prompt to use
      gen = async (ctx, p) => {
        let [k, m, s, h] = ['k', 'm', 's', 'h'].map(x => $L.getItem(x)),
          msg = ctx + p + (s || '\nNO MARKDOWN, BEGIN RAW OUTPUT NOW:'),
          u = h,
          b = { model: m, messages: [{ role: 'user', content: msg }], stream: false, },
          head = { 'Content-Type': 'application/json' },
          req, res, txt
        if (k) head['Authorization'] = `Bearer ${k}`
        A.innerHTML = 'Thinking...'
        try {
          req = await fetch(u, { method: 'POST', headers: head, body: JSON.stringify(b) })
          res = await req.json()
          txt = res.message?.content || res.choices?.[0]?.message?.content
        } catch (e) { txt = e.message }
        return txt || ''
      }
      onhashchange = () => run()
      run()
    }, 0)
    </script>

# How it Works

this project treats the URL `#hash?query=param` as a concatenative machine tape, this means the output of one operation becomes the input of the next. the #hash and ?queries are loaded from the browsers KV store (indexedDB) and then injected into the DOM

when the system first boots it looks for any stored hashes beginning with `boot/*` and runs them

next the system loads the value stored in the #hash key into an accumulator (basically a variable that stores the state of the machine tape)

then one by one it reads each ?query from the KV, executing them in sequence while passing the =params

once the entire tape is run in memory the accumulator dumps the contents into the DOM, any `<script>` tags in the content is rehydrated

# Built in ?query=params

the system comes with the following builtin ?query=params

|Flag|Description|
|:-|:-|
|`a`|**Append Mode**. If `1`, subsequent commands append to the accumulator. If `0` (default), they overwrite it.|
|`f`|**File Pointer**. Sets the target filename (`filename`) for subsequent write (`w`) operations.|
|`c`|**Context**. Loads data (from DB or `src`) into a side-buffer for the AI, without affecting the main accumulator. `0` clears it.|
|`k, m, s, h`|**AI Config**. Sets the API Key (`k`), Model (`m`), System Prompt (`s`), or Host (`h`) in `localStorage`.|
|`e`|**Echo**. Pushes the raw value directly into the accumulator (hardcoded strings/HTML).|
|`r`|**Read**. Reads a file from the database (or `src` for source code) into the accumulator.|
|`u`|**URL**. Fetches text from a remote URL. Implements a **Network-First, Cache-Fallback** mechanism. Successful fetches are passively synced to a discrete `'cache'` IndexedDB namespace. If your OS is offline, it automatically catches the failure and serves the file locally.|
|`p`|**Prompt**. Sends the current context + accumulator + value to the LLM. The result becomes the new accumulator.|
|`w`|**Write**. Saves the current accumulator content to the database under the name defined by `f`.|
|`x`|**Execute**. Runs the value (or the current accumulator if value is empty) as JavaScript.|

# Globals

The kernel exposes the following variables and methods

# Variables

|Variable|Description|
|:-|:-|
|`filename`|**File Pointer**. The name of the current record being read from or written to. Defaults to `MAIN` or the value before `?` in the hash.|
|`BASE`|**Deployment Prefix**. A path segment stripped from the front of the URL before `DB` is derived. Defaults to `''` (root hosting). Set it by declaring `BASE='/yourprefix'` in a `<script>` tag placed *after* `<script id=S>` (the kernel's own line runs first and would otherwise be overwritten). Lets the same kernel resolve namespaces correctly whether it's hosted at `/` or under a subdirectory like `/qrx/`.|
|`DB`|**Database Name**. The name of the active IndexedDB instance, derived from the URL path with `BASE` and any leading/trailing slashes stripped (e.g. `/qrx/wiki` with `BASE='/qrx/'` sets `DB` to `'wiki'`).|
|`MAIN`|**Kernel Name**. The default database name (`'main'`). Used as the fallback/system database when `DB` is set to something else.|
|`os`|**System DB Handle**. A reference to the `MAIN` database connection. Used for "inheritance"—if a file isn't found in `DB`, `read()` looks here.|
|`db`|**Active DB Handle**. The raw `IDBDatabase` connection object for the current `DB`.|
|`FILES`|**Table Name**. The hardcoded name of the object store (`'files'`) within the IndexedDB where all records are saved.|

# Methods

|Method|Description|
|:-|:-|
|`read(k, [d])`|**Async Read**. Returns the content of file `k`. Checks the current database first, then falls back to the `os` database if the file exists there|
|`write(v, [k])`|**Async Write**. Saves value `v` to file `k`. If `k` is omitted, it defaults to the current `filename` pointer|
|`hydrate(h)`|**Render**. Injects HTML string `h` into the main DOM (`<main id=A>`) and recursively executes any embedded `<script>` tags|
|`gen(ctx, p)`|**Vibe Code**. Sends the context buffer `ctx` and prompt `p` to the configured LLM API and returns the generated text|
|`keys([q], [d])`|**List Files**. Returns an array of all keys (filenames) in the database. `q` is an optional `IDBKeyRange`|
|`getDB([n])`|**Database Access**. Returns the IndexedDB instance for name `n`. Defaults to the current active database|
|`run()`|**Re-Run Tape**. Manually triggers the URL parsing loop. Useful if hash state changes programmatically without a reload|

# How to read/use Hyperprompts

once you load the kernel in the browser, either directly by loading the file through the file:/// protocol or serving it through a server like nodejs, you use the following hyperprompts by simply copy+pasting them to the end of your file in the browser's address bar

note the use of &a=1 which allows the outputs to "stack"...this lets smaller models iteratively grow functionality rather than trying to one-shot it



# Example: Writing interface

as a human creating and editing files within the system thru pure hyperlinks is a major bummer, use this hyperprompt to whip up a simple file editing system

    #edit?e&w&p=TASK: output HTML wireframe for a file editor
      - fields: textarea (id="editor")
      - components: status bar (id="status") with character count placeholder
      - css: use flex to make textarea fill full height of window
      - just HTML and CSS
      - no javascript
      - dont include html/head/body tags just the wireframe
    &w&a=1&p=TASK: output a SCRIPT tag that adds autosaving
      - `read()`, `write()`, and `filename` are globally available
      - use `read(filename).then(v => editor.value = v)` to load content into textarea#editor
      - on textarea#editor input, debounce then `write(editor.value, filename)`
      - listen for hashchange: call `read(filename).then(v => editor.value = v)` and focus editor
      - run immediately, no DOMContentLoaded wait
      - use var for all variables (mutable state)
    &w&a=1&p=TASK: output a SCRIPT tag that adds statusbar features
      - listen for input events on textarea#editor
      - calculate character count (value.length)
      - calculate byte size (new Blob([value]).size)
      - update innerText of div#status to show "Chars: X | Bytes: Y"
      - use var for all variables
      - run immediately, no DOMContentLoaded wait
    &w&a=1&p=TASK: output a SCRIPT tag that reloads the editor when edited from another browser tab
      - use BroadcastChannel API with name 'qrx_edit'
      - on textarea#editor input: channel.postMessage({filename: filename})
      - on message event: if event.data.filename == filename, call read(filename).then(v => editor.value = v)
      - ensure status#status updates after reload
      - use var for all variables
      - run immediately, no DOMContentLoaded wait
    &w&a=1&p=TASK: output a SCRIPT tag that initializes external mesh sync
      - call the global function connectSync()
      - wrap in <script>connectSync()</script>
      - this enables cloud/offline sync via #boot/sync
      - use var for all variables
      - run immediately, no DOMContentLoaded wait
    &w&a=1&e=<style>#A {padding: 0 !important}</style>
    &w

# Example: Chat interface

this hyperprompt generates a simple chatbot that can read other files as \[\[wikilinks\]\]

    #chat?e&w&p=TASK: output HTML wireframe for a chatbot
      - components:
        - header
          - model details
            - model name
            - model host
            - apikey (type=password)
        - messages area (no placeholders)
        - footer
          - resizable textarea
          - submit
      - css: use flex so that the messages area fits the space between the header and footer
      - no javascript
      - dont include html/head/body tags just the wireframe
    &w&a=1&p=TASK: output a SCRIPT tag that populates the header details
      - read the value of localStorage.getItem('m') and store it in the model name field
      - do same for localStorage.getItem('h')
      - and localStorage.getItem('k')
      - do nothing else
    &w&a=1&c=src&p=TASK: output a SCRIPT tag that handles the actual chat
      - the attached CONTEXT gives you clues on how to handle API calls
      - reimplement the api call to the LLM (like in gen) using the values from the header inputs
      - implement streaming mode (set stream to true and read chunks)
      - strictly follow the standard openai schema as seen in gen, do NOT include any google specific edge cases
      - create a hook system so that we can add context transformers just before the prompt is sent to the ai
        - just use a global chatPlugins = {pluginName: {callback: function (currentPrompt, fullChat) {returns transformedText}}}
        - create a plugin that console.logs the text before it's sent
      - send the full chat + the users prompt as a single string (no need to send array of messages)
      - send when user presses either CTRL+ENTER inside the textarea OR when they press submit button
      - textarea is cleared upon submit
      - textarea is resizable
      - do not autoscroll the page
    &w&a=1&p=TASK: output a SCRIPT tag to add a new context transformer plugin
      - window.DB is a global that contains the database table name
      - create a RECURSIVE function to extract and replace `[[link]]`s
      - pass a `visited = new Set()` and a `depth = 0` down the recursion to prevent infinite loops and cap recursion at depth <= 2 to avoid context explosion
      - [[links]] can be in form table%23record assume the following:
        - [[link]] === [[${DB}%23link]]; name === ${DB}
        - [[%23link]] === [[${DB}%23link]]; name === ${DB}
        - [[some%23link]] === [[some%23link]]; name === some
      - use `read(link, name).then(context=>{})` to replace the [[link]] with the context
        - wrap the context with "<context file="some%23link">...data...</context>"
        - RECURSIVELY scan the fetched context for MORE [[links]] before returning the string
      - console.log the link and the context for debugging
      - return the fully transformed context including all deep nested links
      - only extract [[links]] stemming from the current PROMPT not the whole chat history
      - try...catch it, often the links wont exist yet; silently quiet those errors
      - replace %23 with actual hash symbol
      - be mindful of [object Promise] Promise.all() when doing async string replacement!!! DOUBLE CHECK YOU ARE CORRECTLY HANDLING PROMISES
      - BE CAREFUL ABOUT PROMISES: fetch() read() etc ALL ARE PROMISES [object Promise] <--- BE EXTREMELY AWARE OF THIS
      - [object Promise] keeps getting sent YOU MUST BE MINDFUL OF PROMISES!! BE HYPER AWARE OF PROMISES read() fetch() etc ALL MUST BE .then()
    &w



# Example: Tool using agent

you can create a tool using agent that can use skill files and even build its own tools

    #agent?e&w&p=TASK: output HTML wireframe for an autonomous agent
    - components:
    - header (inputs for model-name, host, apikey type=password)
    - split-view container (use flex row)
    - left-panel (for agent internal monologue and tools; no placeholders)
    - right-panel (for the final chat with user; no placeholders)
    - footer (resizable textarea id="user-input", submit button id="submit-btn", stop button id="stop-btn")
    - css: use flex so the split-view fits the space between header and footer
    - css: left-panel and right-panel should be 50 percent width and scrollable
    - no javascript
    - dont include html/head/body tags just the wireframe
    &w&a=1&p=TASK: output a SCRIPT tag that populates the header details
    - read the value of localStorage.getItem('m') and store it in the model-name DOM input
    - do same for localStorage.getItem('h') into host input
    - do same for localStorage.getItem('k') into apikey input
    - create global array: window.chatHistory =[]
    - create global object: window.agentScratchpad = {}
    - create global string: window.agentPlan = "Pending initialization."
    - create global boolean: window.stopAgent = false
    - use var for all variable declarations
    &w&a=1&p=TASK: output a SCRIPT tag creating UI helper functions
    - create function printLeft(text, isObservation)
    - creates a div, sets whiteSpace to 'pre-wrap'. if isObservation is true, set color to 'aa5500'. append text, append to left-panel, scroll to bottom.
    - create function printRight(text)
    - creates a div, sets whiteSpace to 'pre-wrap', fontWeight to 'bold'. append text, append to right-panel, scroll to bottom.
    - use var for all variable declarations
    &w&a=1&p=TASK: output a SCRIPT tag creating dynamic tool loader and executor
    - DO NOT hardcode any base tools. The agent must be completely agnostic.
    - create global async function window.getActiveToolsString()
    - inside function: var lines =[];
    - var matchedKeys = await keys(IDBKeyRange.bound('tool', 'tool\uffff'));
    - loop through matchedKeys: var c = await read(matchedKeys[i]); var desc = "No description"; if (c %26%26 c.includes("/*")) { desc = c.split("*/")[0].split("/*")[1].trim(); } lines.push(matchedKeys[i] %2B ' - ' %2B desc);
    - return lines.length > 0 %3F lines.join('\n') : "No tools found.";
    - create global async function window.executeTool(toolName, toolInput)
    - inside a try/catch block:
    - var code = await read(toolName);
    - if (!code %26%26 toolName.indexOf('tools/') !== 0) { code = await read('tools/' %2B toolName); }
    - if (!code) throw new Error("Tool not found.");
    - evaluate the code EXACTLY using this syntax: return await new Function('INPUT', 'return (async () => {' %2B code %2B '})()')(toolInput);
    - catch error: call console.error("Tool Execution Failed:", err, "Code Evaluated:", code); return "Tool Execution Error: " %2B err.message;
    - use var for all variable declarations
    &w&a=1&p=TASK: output a SCRIPT tag creating an LLM fetch helper
    - create global async function window.fetchAI(systemPrompt)
    - read model-name, host, apikey from DOM inputs.
    - save those 3 values to localStorage as 'm', 'h', and 'k'.
    - create messages array: first item is { role: 'system', content: systemPrompt }. concatenate window.chatHistory.
    - execute fetch to host URL with method POST, standard headers (Bearer apikey if exists), body: JSON.stringify({ model: document.getElementById('model-name').value, messages: messages, stream: false }).
    - return the parsed text content from the response choices.
    - use var for all variable declarations
    &w&a=1&p=TASK: output a SCRIPT tag creating regex parsers
    - create function window.parseAction(text)
    - match regex for: /<<ACTION:\s*([^>]%2B)>>\n([\s\S]*%3F)(%3F=<<|$)/
    - if matched, return { name: match[1].trim(), input: match[2].trim() }. else return null.
    - create function window.parseAnswer(text)
    - match regex for: /<<ANSWER>>\n([\s\S]*%3F)(%3F=<<|$)/
    - if matched, return the extracted string. else return null.
    - use var for all variable declarations
    &w&a=1&c=src&p=TASK: output a SCRIPT tag creating the core agent reasoning loop
    - create global async function window.runAgent(userMessage)
    - reset: window.agentScratchpad = {}; window.agentPlan = "Task started.";
    - call printRight(userMessage). push { role: 'user', content: userMessage } to window.chatHistory.
    - var errorCount = 0; start an infinite while(true) loop.
    - inside loop: console.log("--- NEW AGENT LOOP START ---");
    - inside loop: var toolsString = await window.getActiveToolsString();
    - inside loop: var inventory = Object.keys(window.agentScratchpad);
    - inside loop: var invString = ""; if (inventory.length > 0) { for(var i=0; i<inventory.length; i%2B%2B) { invString %2B= "=== MEMORY POINTER: " %2B inventory[i] %2B " ===\n" %2B window.agentScratchpad[inventory[i]] %2B "\n\n"; } } else { invString = "[Empty]"; }
    - inside loop: build var systemPrompt = "You are an autonomous AI operating in a pointer-based memory architecture. Do not hallucinate file contents.\n\nCRITICAL RULE: DO NOT USE XML. NEVER output <tool_call> or <function> tags. You must use the EXACT syntax <<ACTION: tool_name>> and <<ANSWER>>.\n\nOUTPUT FORMAT:\nTo use a tool: <<ACTION: tool_name>>\ninput_data\n\nTo finish: <<ANSWER>>\nfinal_message\n\nCURRENT PLAN:\n" %2B window.agentPlan %2B "\n\nWORKING MEMORY CONTENTS:\n" %2B invString %2B "\n\nAVAILABLE TOOLS:\n" %2B toolsString;
    - inside loop: console.log("1. System Prompt length (bytes):", systemPrompt.length);
    - inside loop: if window.stopAgent is true, append "\nUSER OVERRIDE: Stop executing tools. Output <<ANSWER>>." to systemPrompt, and set window.stopAgent = false.
    - inside loop: console.log("2. Fetching AI...");
    - inside loop: var aiResponse = await window.fetchAI(systemPrompt);
    - inside loop: console.log("3. AI Raw Response:\n", aiResponse);
    - inside loop: call printLeft(aiResponse, false). push { role: 'assistant', content: aiResponse } to window.chatHistory.
    - inside loop: var action = window.parseAction(aiResponse);
    - inside loop: if action exists: console.log("4. Executing Action:", action); var result = await window.executeTool(action.name, action.input); console.log("5. Tool Result:", result); call printLeft("OBSERVATION:\n" %2B result, true); push { role: 'user', content: "OBSERVATION:\n" %2B result } to window.chatHistory; continue loop;
    - inside loop: var answer = window.parseAnswer(aiResponse);
    - inside loop: if answer exists: console.log("4. Loop Finished. Answer:", answer); call printRight(answer); break loop;
    - inside loop (fallback): console.warn("4. Syntax Fallback Triggered. AI failed to use <<ACTION>> or <<ANSWER>>."); push { role: 'user', content: 'SYSTEM WARNING: You MUST output <<ACTION: name>> or <<ANSWER>>. NO XML. DO NOT USE <tool_call> tags.' } to window.chatHistory; continue loop;
    - wrap loop in try/catch. on catch: errorCount%2B%2B, console.error("Agent Loop Error:", e), printLeft("Error: " %2B e.message, true), break loop if errorCount >= 7.
    - use var for all variable declarations
    &w&a=1&p=TASK: output a SCRIPT tag binding UI events
    - get DOM elements for submit-btn, stop-btn, user-input textarea.
    - create function handleSubmit(e) { if(e %26%26 e.preventDefault) e.preventDefault(); if(userInput.value.trim() !== '') { window.runAgent(userInput.value); userInput.value = ''; } }
    - bind click event to submit-btn.
    - bind keydown event to textarea (if ctrlKey and key is 'Enter', call handleSubmit).
    - bind click event to stop-btn to set window.stopAgent = true.
    - use var for all variable declarations
    &w

# Example: Desktop Metaphor

you can also build a desktop metaphor visualizer, where the KV store is visualized as desktop folders and files. you can even have the desktop run other files as draggable windows using iframes, including loading the system within itself (known as a quine)

    #main?e&w&p=TASK: output HTML wireframe for a windows 95 simulator
      - start menu with "🪟 Start" button and  time area (no start panel yet)
      - a hidden, reusable window template with
        - title
        - min, max, close buttons
        - address bar with refresh icon and "Go" button
      - windows teal background
      - basic css reset like margin: 0 for body and box-sizing
      - no javascript
      - don't include html/head/body tags just the wireframe
    &w&a=1&p=TASK: output SCRIPT tag for rendering top level icons
      - loop through each indexeddb record
        - the database is in the global strings `window.DB` and the table name is in `window.FILES`
      - keys can have slashes in them denoting folders
      - create a 📄 icon for every top level file
        - the label is everything after the final / (or the whole string)
      - create a 📁 icon for every top level folder
        - the label is everything before the first / at that level
    &w&a=1&p=TASK: output SCRIPT tag for File Explorer
      - when folder icon is single clicked or tapped, show a window for it
      - set the addressbar to full/folder/path
      - focus the addressbar on open
      - generate more icons and folders for the current folder inside the window
      - when clicking on a folder inside File Explorer update the addressbar and icons
      - clicking the Go button or pressing enter in the address bar navigates that window
      - don't handle other window interaction yet
    &w&a=1&p=TASK: output SCRIPT tag for showing file windows on icon clicks
      - name the file opening function exactly `openFileWindow` and assign it to `window.openFileWindow`
      - when file icon is single clicked or tapped, show a window for it
      - show a full size iframe in the windows content area
      - set the addressbar to full/file/path
      - set the iframe path to just `${window.DB}%23${full/file/path}`
      - listen for %23hash changes inside the iframe and update the addressbar on change (be mindful of loops)
      - keep addressbar and iframe synced
      - when user presses enter in the addressbar or presses Go, the iframe should update to the new URL
      - do this for file icons in folders too
      - don't handle other window interaction yet
      - URLs must always be in the form db%23file
        - if no db name is present assume ${window.DB}
        - if no %23 hash symbol is present, assume the whole thing is a hash
      - example: if DB='main' then %23chat should map to main%23chat
      - example: if DB='apps/paint' and file is 'art/selfie' then it should map to apps/paint%23art/selfie
    &w&a=1&p=TASK: output SCRIPT tag for handling windows
      - make windows draggable by dragging the titlebar
      - make windows resizable
        - make sure any window body elements and iframe resize to fit new window size too (this often fails to work due to nested elements)
      - make windows closable
      - make windows maximizable (and restore size when pressed again)
      - make windows minizable (and show an icon for it in the startbar
    &w&a=1&p=TASK: update taskbar time area to show live clock and battery status
      - locate the existing time area element inside the taskbar
      - create a function that gets new Date and formats it as h:mm A
      - use setInterval to run this clock function every 1000ms and update the DOM
      - call navigator.getBattery and resolve the promise
      - inside the promise create an update function that reads battery level
      - multiply the level by 100 to get the percent value
      - check the charging boolean
      - format the output as a plug icon if charging or a battery icon if not alongside the percent
      - add event listeners for levelchange and chargingchange to automatically update the ui
      - render both the battery string and the clock string side by side in the time area element
    &w&a=1&p=TASK: make the refresh icon reload the window iframe
      - use event delegation to check if the clicked target matches the template window refresh buttons
      - if so reload that windows iframe
    &w&a=1&p=TASK: output a SCRIPT tag that adds global Speech-to-Text with DEEP DEBUGGING
      - initialize window.SpeechRecognition || window.webkitSpeechRecognition with continuous = true and interimResults = false
      - console.log("Speech API found:", !!(window.SpeechRecognition || window.webkitSpeechRecognition))
      - create a 🎙️ button and append it to the taskbar. console.log("Mic button added")
      - on the button's 'mousedown' event: call event.preventDefault() to prevent focus stealing, toggle a listening boolean, and console.log("Mic clicked. State listening:", state)
      - when listening: change button text to 🔴 and call recognition.start() inside a try/catch that console.errors failures
      - when stopped: change to 🎙️ and call recognition.stop()
      - add recognition.onstart: console.log("Speech started successfully")
      - add recognition.onerror: console.error("Speech error:", event.error)
      - add recognition.onend: console.log("Speech ended"). if state is listening, set 200ms timeout to try recognition.start() again
      - on recognition result: get the final transcript string and console.log("Heard:", transcript)
      - traverse to find the focused field: var el = document.activeElement; console.log("Base active element:", el)
      - while el is an IFRAME, wrap in try/catch: switch el to el.contentDocument.activeElement and console.log("Iframe active element:", el). catch and console.error the error.
      - if el is an INPUT or TEXTAREA: console.log("Target found!", el), then append the transcript (adding a leading space if needed), update el.value, and dispatch a new Event('input', { bubbles: true })
      - if el is NOT an input/textarea: console.warn("Active element is not a text field. Text discarded.")
      - wrap in an async IIFE and use var for all variables
    &w&a=1&p=TASK: output a SCRIPT tag that binds Ctrl+Space to open or focus the run window
      - add a keydown event listener to the window
      - if event.ctrlKey is true and (event.code is 'Space' or event.key is ' ')
      - call event.preventDefault()
      - FIRST, prevent duplicates: search the DOM for an input field whose value ends with 'run'
      - if found, call .focus() on it and return
      - IF NOT FOUND, we must use the existing UI to spawn it so all event listeners attach correctly
      - query the DOM for all file icon elements
      - loop through them, get their textContent, replace the '📄' character, and trim whitespace
      - if the cleaned text exactly equals 'run', call .click() on that element
      - then use setTimeout for 100ms
      - inside the timeout, search the DOM again for the newly spawned input field whose value ends with 'run'
      - if found, call .focus() on it
      - use var for all variables
    &w&a=1&p=TASK: output a SCRIPT tag that builds a global typeahead datalist from the file index
      - wrap everything in an async IIFE using var for all variables
      - fetch '/data/index.json' and parse as JSON — if it fails use an empty array
      - attempt to read localStorage.getItem('SYNC_KEY') into a var
      - if SYNC_KEY is truthy, also fetch '/data/index.private.json' with header Authorization: SYNC_KEY and parse as JSON — if this fetch fails or returns non-ok, use an empty array
      - merge both arrays into one deduplicated list using a Set
      - for each item in the merged list, replace the first '/' with '%23' (namespace/key → namespace%23key)
      - create a <datalist> element with id 'sys-file-list'
      - for each modified item create an <option> with that value and append it to the datalist
      - append the datalist to document.body
      - add a focusin listener on document: if event.target is an INPUT, set its list attribute to 'sys-file-list'
    &w&a=1&e=<script>window.dispatchEvent(new CustomEvent('main:ready'))</script>
    &w

# Example: App Launcher Shortcut

you can extend other hyperprompts by creating bootfiles specific to those #hashes. this helps you avoid running the entire tap. for example to add a CTRL+SPACE keyboard shortcut to let you open windows by name with typeahead:

    #boot/hotkeys/ctrl_space?e=if(window._bootCtrlSpace)return;window._bootCtrlSpace=true;window.addEventListener('keydown', function(e) {
      if (e.ctrlKey %26%26 (e.code === 'Space' || e.key === ' ')) {
        if (window !== window.top) {
          e.preventDefault();
          window.top.focus();
          var clone = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            code: 'Space',
            key: ' '
          });
          window.top.document.dispatchEvent(clone);
        }
      }
    });&w

# Going Further

this kernel is designed to be isomorphic to the environment it's running in...later we will explore how to get this kernel running natively on a smartwatch, r/esp32, and other environments

for a live demo see: https://hyperprompter.github.io/qrx/#main

for a work-in-progress demo INSIDE reddit see this post: https://www.reddit.com/r/Hyperprompting/comments/1uenrfs/devlog_towards_a_social_operating_system/

this tiny kernel packs quite a lot of functionality, the best way to go further is to use your LLM to chat this post or the github repository
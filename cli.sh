#!/usr/bin/env bash

# QRx CLI - Bash environment for hyperlink-as-tape protocol
# Implements the same flags as index.html kernel

set -euo pipefail

# Configuration directory for AI settings
CONFIG_DIR="${HOME}/.config/qrx"
mkdir -p "${CONFIG_DIR}"

# Default values
DATA_DIR="./data"
MAIN="main"
DB="${MAIN}"
ACCUMULATOR=""
CONTEXT=""
APPEND_MODE=0

# Get AI config from persistent storage
get_config() {
    local key="$1"
    local file="${CONFIG_DIR}/${key}"
    if [ -f "${file}" ]; then
        cat "${file}"
    fi
}

# Set AI config to persistent storage
set_config() {
    local key="$1"
    local val="$2"
    echo -n "${val}" > "${CONFIG_DIR}/${key}"
}

# Read file from data directory
# Syntax: namespace#path or just #path (defaults to main)
read_file() {
    local key="$1"
    local ns="${DB}"
    local path="${key}"
    
    # Parse namespace#path
    if [[ "${key}" == *"#"* ]]; then
        ns="${key%%#*}"
        path="${key#*#}"
    fi
    
    local filepath="${DATA_DIR}/${ns}/${path}"
    
    if [ -f "${filepath}" ]; then
        cat "${filepath}"
    elif [ "${ns}" != "${MAIN}" ]; then
        # Fallback to main namespace
        local fallback="${DATA_DIR}/${MAIN}/${path}"
        if [ -f "${fallback}" ]; then
            cat "${fallback}"
        fi
    fi
}

# Write file to data directory
write_file() {
    local content="$1"
    local key="$2"
    local ns="${DB}"
    local path="${key}"
    
    # Parse namespace#path
    if [[ "${key}" == *"#"* ]]; then
        ns="${key%%#*}"
        path="${key#*#}"
    fi
    
    local filepath="${DATA_DIR}/${ns}/${path}"
    local dirpath="$(dirname "${filepath}")"
    
    mkdir -p "${dirpath}"
    echo -n "${content}" > "${filepath}"
}

# Fetch URL with cache fallback
fetch_url() {
    local url="$1"
    local cache_key="${url//\//_}"
    local cache_file="${DATA_DIR}/cache/${cache_key}"
    
    if curl -s -L "${url}" -o /tmp/qrx_fetch_$$ 2>/dev/null; then
        local content="$(cat /tmp/qrx_fetch_$$)"
        rm -f /tmp/qrx_fetch_$$
        
        # Cache the result
        mkdir -p "${DATA_DIR}/cache"
        echo -n "${content}" > "${cache_file}"
        
        echo -n "${content}"
    else
        # Fallback to cache
        if [ -f "${cache_file}" ]; then
            cat "${cache_file}"
        else
            echo "Error: Failed to fetch ${url} and no cache available" >&2
        fi
        rm -f /tmp/qrx_fetch_$$
    fi
}

# Generate AI response
gen_ai() {
    local prompt="$1"
    local api_key="$(get_config k)"
    local model="$(get_config m)"
    local system="$(get_config s)"
    local host="$(get_config h)"
    
    if [ -z "${host}" ]; then
        echo "Error: AI host not configured. Set with ?h=https://api.example.com/v1/chat/completions" >&2
        return 1
    fi
    
    local full_prompt="${prompt}${system:-\nNO MARKDOWN, BEGIN RAW OUTPUT NOW:}"
    
    # Build JSON request
    local json_msg="$(echo -n "${full_prompt}" | jq -Rs .)"
    local json_model="${model:-gpt-3.5-turbo}"
    local json_body="{\"model\":\"${json_model}\",\"messages\":[{\"role\":\"user\",\"content\":${json_msg}}],\"stream\":false}"
    
    echo "Thinking..." >&2
    
    # Make API request
    local response=""
    if [ -n "${api_key}" ]; then
        response="$(curl -s -X POST "${host}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${api_key}" \
            -d "${json_body}")"
    else
        response="$(curl -s -X POST "${host}" \
            -H "Content-Type: application/json" \
            -d "${json_body}")"
    fi
    
    # Extract content from response
    echo -n "${response}" | jq -r '.message.content // .choices[0].message.content // empty' 2>/dev/null || echo "Error: Failed to parse AI response" >&2
}

# Parse and execute hyperlink
execute_hyperlink() {
    local input="$1"
    
    # Validate it's a valid hyperlink format
    if [[ ! "${input}" =~ ^#?[^?]*(\?.*)? ]]; then
        echo "Error: Invalid hyperlink format. Expected: [namespace]#[path]?[flags]" >&2
        return 1
    fi
    
    # Remove leading # if present
    input="${input#\#}"
    
    # Split into path and query
    local hash_part="${input%%\?*}"
    local query_part=""
    if [[ "${input}" == *"?"* ]]; then
        query_part="${input#*\?}"
    fi
    
    # Set filename and DB from hash part
    local filename="${hash_part}"
    if [[ "${hash_part}" == *"#"* ]]; then
        DB="${hash_part%%#*}"
        filename="${hash_part#*#}"
    else
        # If no namespace specified, treat entire hash as filename in current DB
        filename="${hash_part}"
    fi
    
    # Initialize accumulator with file content if it exists
    ACCUMULATOR="$(read_file "${hash_part}" || echo "")"
    CONTEXT=""
    APPEND_MODE=0
    local file_pointer="${filename}"
    
    # Parse query parameters
    if [ -n "${query_part}" ]; then
        # Split on & and process each parameter
        IFS='&' read -ra PARAMS <<< "${query_part}"
        for param in "${PARAMS[@]}"; do
            local key="${param%%=*}"
            local val=""
            if [[ "${param}" == *"="* ]]; then
                val="${param#*=}"
                # URL decode
                val="$(echo -e "${val//%/\\x}")"
            fi
            
            case "${key}" in
                a)
                    # Append mode
                    if [ "${val}" != "0" ]; then
                        APPEND_MODE=1
                    else
                        APPEND_MODE=0
                    fi
                    ;;
                f)
                    # File pointer
                    file_pointer="${val}"
                    ;;
                c)
                    # Context buffer
                    if [ "${val}" == "0" ]; then
                        CONTEXT=""
                    else
                        local ctx_content="$(read_file "${val}")"
                        CONTEXT="<CONTEXT>${CONTEXT}</CONTEXT>
${ctx_content}"
                    fi
                    ;;
                k|m|s|h)
                    # AI config
                    set_config "${key}" "${val}"
                    ;;
                e)
                    # Echo
                    if [ "${APPEND_MODE}" -eq 1 ]; then
                        ACCUMULATOR="${ACCUMULATOR}${val}"
                    else
                        ACCUMULATOR="${val}"
                    fi
                    ;;
                r)
                    # Read
                    local content="$(read_file "${val}")"
                    if [ "${APPEND_MODE}" -eq 1 ]; then
                        ACCUMULATOR="${ACCUMULATOR}${content}"
                    else
                        ACCUMULATOR="${content}"
                    fi
                    ;;
                u)
                    # URL fetch
                    local content="$(fetch_url "${val}")"
                    if [ "${APPEND_MODE}" -eq 1 ]; then
                        ACCUMULATOR="${ACCUMULATOR}${content}"
                    else
                        ACCUMULATOR="${content}"
                    fi
                    ;;
                p)
                    # Prompt
                    local full_context="${CONTEXT}${ACCUMULATOR}"
                    local result="$(gen_ai "${full_context}${val}")"
                    if [ "${APPEND_MODE}" -eq 1 ]; then
                        ACCUMULATOR="${ACCUMULATOR}${result}"
                    else
                        ACCUMULATOR="${result}"
                    fi
                    ;;
                w)
                    # Write
                    write_file "${ACCUMULATOR}" "${file_pointer}"
                    ;;
            esac
        done
    fi
    
    # Output accumulator to terminal
    if [ -n "${ACCUMULATOR}" ]; then
        echo "${ACCUMULATOR}"
    fi
}

# Main REPL
main() {
    if [ $# -eq 0 ]; then
        # Interactive mode
        echo "QRx CLI - Hyperlink Prompt Interface"
        echo "Enter hyperlinks (e.g., test#hello?e=world&w) or 'exit' to quit"
        echo ""
        
        while true; do
            read -p "qrx> " input
            
            if [ -z "${input}" ]; then
                continue
            fi
            
            if [ "${input}" == "exit" ] || [ "${input}" == "quit" ]; then
                break
            fi
            
            execute_hyperlink "${input}" || true
        done
    else
        # Execute single hyperlink from arguments
        execute_hyperlink "$1"
    fi
}

main "$@"

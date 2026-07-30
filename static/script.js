// --- Global State & Initialization ---
hljs.highlightAll();

// 1. Robust Storage Prefix & Guest Isolation Handling
const currentUsername = document.querySelector('.username-display')?.textContent?.trim() || "default_user";
const isGuestUser = (currentUsername === "Guest User" || currentUsername === "default_user" || !currentUsername || currentUsername === "None");

let storagePrefix;
let activeStorage = localStorage;

if (isGuestUser) {
    let guestTabId = sessionStorage.getItem("doxa_guest_tab_id");
    if (!guestTabId) {
        guestTabId = 'guest_' + Math.random().toString(36).substring(2, 9);
        sessionStorage.setItem("doxa_guest_tab_id", guestTabId);
    }
    storagePrefix = `doxa_temp_${guestTabId}_`;
    activeStorage = sessionStorage; // Guests use sessionStorage so data never bleeds or persists globally
} else {
    storagePrefix = `doxa_${currentUsername}_`;
    activeStorage = localStorage;
}

let chatHistories = JSON.parse(activeStorage.getItem(storagePrefix + 'chat_histories') || '[]');
let currentChatId = Number(activeStorage.getItem(storagePrefix + 'current_chat_id')) || Date.now();

let currentChatHistory = JSON.parse(activeStorage.getItem(storagePrefix + `conv_${currentChatId}`) || JSON.stringify([
    { "role": "model", "parts": [{ "text": "Doxa AI core is online. How can I assist you today?" }] }
]));

let isFirstMessage = activeStorage.getItem(storagePrefix + `is_first_${currentChatId}`) !== 'false' && currentChatHistory.length <= 1;
let currentAttachedFile = null;
let currentAiMode = 'standard';

const sidebar = document.getElementById('sidebar');
const welcomeScreen = document.getElementById('welcome-screen');
const chatContainer = document.getElementById('chat-container');
const activeInputArea = document.getElementById('active-input-area');
const sidebarHistoryContainer = document.getElementById('sidebar-history');
const userInputWelcome = document.getElementById('user-input');
const userInputActive = document.getElementById('user-input-active');

document.addEventListener('DOMContentLoaded', async () => {
    setupPreviewContainers();
    
    if (!isFirstMessage && currentChatHistory.length > 1) {
        restoreUIState();
    } else {
        if (welcomeScreen) welcomeScreen.style.display = 'flex';
        if (chatContainer) chatContainer.style.display = 'none';
        if (activeInputArea) activeInputArea.style.display = 'none';
    }

    try {
        const res = await fetch('/api/history');
        const data = await res.json();
        
        const chatListContainer = document.getElementById('chat-history-list'); 
        if (chatListContainer) {
            chatListContainer.innerHTML = ''; 
            
            if (data.success && data.chats && data.chats.length > 0) {
                chatHistories = data.chats.map(c => ({ id: c.chat_id, title: c.title }));
                saveStorage();
                
                data.chats.forEach(chat => {
                    const item = document.createElement('div');
                    item.className = 'chat-history-item';
                    item.textContent = chat.title || 'New Chat';
                    item.onclick = () => loadServerChat(chat.chat_id);
                    chatListContainer.appendChild(item);
                });
            } else {
                chatListContainer.innerHTML = '<div style="padding: 16px; color: var(--text-secondary); font-size: 13px; text-align: center;">No chat history</div>';
            }
        }
    } catch (err) {
        console.error('Failed to load chat history:', err);
    }
    
    renderSidebarHistory();

    const chatInput = document.querySelector('.chat-input-textarea') || document.querySelector('textarea');

    if (chatInput) {
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }
});


// --- Input & File Preview Setup ---
function setupPreviewContainers() {
    [userInputWelcome, userInputActive].forEach(input => {
        if (!input) return;
        const wrapper = input.closest('.input-box-wrapper') || input.parentElement;
        if (wrapper && !wrapper.querySelector('.file-preview-container')) {
            const previewDiv = document.createElement('div');
            previewDiv.className = 'file-preview-container';
            previewDiv.style.display = 'none';
            previewDiv.style.padding = '8px 12px 0 12px';
            wrapper.insertBefore(previewDiv, wrapper.firstChild);
        }
    });
}

[userInputWelcome, userInputActive].forEach(input => {
    if (!input) return;
    input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});

// --- Smart Sidebar Toggle (Desktop Collapse vs Mobile Drawer) ---
window.toggleSidebar = function() {
    if (!sidebar) return;
    
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        sidebar.classList.toggle('open');
        let isOpen = sidebar.classList.contains('open');
        
        let backdrop = document.getElementById('sidebar-backdrop');
        
        if (isOpen) {
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'sidebar-backdrop';
                backdrop.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1050; backdrop-filter: blur(2px);";
                backdrop.onclick = () => {
                    sidebar.classList.remove('open');
                    backdrop.remove();
                };
                document.body.appendChild(backdrop);
            }
        } else {
            if (backdrop) {
                backdrop.remove();
            }
        }
    } else {
        sidebar.classList.toggle('collapsed');
        sidebar.classList.remove('open');
        
        let backdrop = document.getElementById('sidebar-backdrop');
        if (backdrop) backdrop.remove();
    }
};

function toggleAttachmentMenu(context) {
    const menu = document.getElementById(`attachment-menu-${context}`);
    const btn = document.getElementById(`plus-btn-${context}`);

    document.querySelectorAll('.attachment-menu').forEach(m => {
        if (m !== menu) m.classList.remove('open');
    });
    document.querySelectorAll('.plus-btn').forEach(b => {
        if (b !== btn) b.classList.remove('spinning');
    });

    if (menu) menu.classList.toggle('open');
    if (btn) btn.classList.toggle('spinning');
}

window.addEventListener('click', (e) => {
    if (!e.target.closest('.input-box-wrapper') && !e.target.closest('.model-select-btn') && !e.target.closest('.model-dropdown-menu')) {
        document.querySelectorAll('.attachment-menu').forEach(m => m.classList.remove('open'));
        document.querySelectorAll('.plus-btn').forEach(b => b.classList.remove('spinning'));
        const dropdown = document.getElementById('modelDropdown');
        if (dropdown) dropdown.classList.remove('open');
    }
});

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    currentAttachedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        showFilePreview(file, e.target.result);
    };
    reader.readAsDataURL(file);

    document.querySelectorAll('.attachment-menu').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.plus-btn').forEach(b => b.classList.remove('spinning'));
}

function showFilePreview(file, dataUrl) {
    [userInputWelcome, userInputActive].forEach(input => {
        if (!input) return;
        const wrapper = input.closest('.input-box-wrapper') || input.parentElement;
        if (!wrapper) return;
        let previewContainer = wrapper.querySelector('.file-preview-container');
        if (!previewContainer) {
            previewContainer = document.createElement('div');
            previewContainer.className = 'file-preview-container';
            previewContainer.style.padding = '8px 12px 0 12px';
            wrapper.insertBefore(previewContainer, wrapper.firstChild);
        }

        previewContainer.style.display = 'flex';
        previewContainer.innerHTML = `
            <div class="file-preview-pill" style="display: inline-flex; align-items: center; background: var(--bg-hover, #2a2a2a); border: 1px solid var(--border-color, #444); border-radius: 8px; padding: 6px 10px; gap: 8px; max-width: fit-content;">
                ${file.type.startsWith('image/') 
                    ? `<img src="${dataUrl}" style="width: 36px; height: 36px; object-fit: cover; border-radius: 4px;" />` 
                    : `<span class="material-icons-outlined" style="font-size: 24px; color: #9ca3af;">insert_drive_file</span>`
                }
                <div style="display: flex; flex-direction: column; overflow: hidden; max-width: 160px;">
                    <span style="font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main, #fff);">${file.name}</span>
                    <span style="font-size: 10px; color: #9ca3af;">${file.type.startsWith('image/') ? 'Image' : 'Document'}</span>
                </div>
                <button type="button" onclick="clearAttachedFile()" style="background: none; border: none; cursor: pointer; color: #9ca3af; display: flex; align-items: center; padding: 2px; margin-left: 4px;" title="Remove file">
                    <span class="material-icons-outlined" style="font-size: 16px;">close</span>
                </button>
            </div>
        `;
    });
}

function clearAttachedFile() {
    currentAttachedFile = null;
    document.querySelectorAll('.file-preview-container').forEach(container => {
        container.style.display = 'none';
        container.innerHTML = '';
    });
    document.querySelectorAll('input[type="file"]').forEach(input => input.value = '');
}

async function fileToGenerativePart(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            resolve({
                inlineData: {
                    data: reader.result.split(",")[1],
                    mimeType: file.type
                }
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// --- Personality Selection & Global UI Toggles ---
window.toggleModelDropdown = function() {
    const dropdown = document.getElementById('modelDropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
};

function selectPersonality(name, modeKey) {
    const label = document.getElementById('current-model-label');
    if (label) label.innerText = name;
    currentAiMode = modeKey;
    
    const dropdown = document.getElementById('modelDropdown');
    if (dropdown) dropdown.classList.remove('open');
    
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
    
    showToast(`AI Personality switched to: ${name}`);
}

function showToast(message) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = "position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-main); padding: 8px 16px; border-radius: 20px; font-size: 0.85rem; box-shadow: 0 5px 20px rgba(0,0,0,0.5); z-index: 1000; transition: opacity 0.3s;";
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// --- Read More / Collapsible Helper ---
function makeCollapsible(msgDiv, contentElement) {
    if (!msgDiv.classList.contains('user-message')) return;
    setTimeout(() => {
        if (contentElement.scrollHeight > 90) {
            contentElement.classList.add('clamped');
            
            const wrapper = contentElement.closest('.user-message, .ai-message') || msgDiv;
            let toggleBtn = wrapper.querySelector('.read-more-btn');
            
            if (!toggleBtn) {
                toggleBtn = document.createElement('button');
                toggleBtn.className = 'read-more-btn';
                toggleBtn.innerText = 'Read More';
                toggleBtn.style.display = 'block';
                
                toggleBtn.onclick = () => {
                    const expanded = contentElement.classList.toggle('expanded');
                    contentElement.classList.toggle('clamped', !expanded);
                    toggleBtn.classList.toggle('expanded', expanded);
                    toggleBtn.innerHTML = expanded ? 'Show Less' : 'Show More';
                };
                
                wrapper.appendChild(toggleBtn);
            }
        }
    }, 50);
}

// --- Gemini-Style Code Block Enhancement Pipeline ---
function enhanceCodeBlocks(container = document) {
    container.querySelectorAll('pre').forEach(pre => {
        if (pre.dataset.enhanced) return;
        pre.dataset.enhanced = 'true';

        const codeEl = pre.querySelector('code');
        let lang = 'code';
        if (codeEl) {
            const match = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
            if (match) lang = match.replace('language-', '');
        }

        const header = document.createElement('div');
        header.className = 'code-header';
        header.innerHTML = `
            <span class="code-lang-badge">${lang}</span>
            <div class="code-actions">
                <button class="code-action-btn" onclick="copyCodeBlock(this)" title="Copy code">
                    <span class="material-icons-outlined" style="font-size: 16px;">content_copy</span>
                </button>
                <button class="code-action-btn" onclick="downloadCodeBlock(this)" title="Download file">
                    <span class="material-icons-outlined" style="font-size: 16px;">download</span>
                </button>
            </div>
        `;

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'code-content-wrapper';

        pre.parentNode.insertBefore(header, pre);
        contentWrapper.appendChild(pre);

        const blockContainer = document.createElement('div');
        blockContainer.className = 'code-block-container';
        header.parentNode.insertBefore(blockContainer, header);
        blockContainer.appendChild(header);
        blockContainer.appendChild(contentWrapper);
    });
}

window.copyCodeBlock = function(btn) {
    const blockContainer = btn.closest('.code-block-container');
    const codeEl = blockContainer.querySelector('code') || blockContainer.querySelector('pre');
    if (codeEl) {
        navigator.clipboard.writeText(codeEl.innerText);
        const iconSpan = btn.querySelector('.material-icons-outlined');
        const originalIcon = iconSpan.innerText;
        
        iconSpan.innerText = 'check';
        setTimeout(() => {
            iconSpan.innerText = originalIcon;
        }, 2000);
    }
};

window.downloadCodeBlock = function(btn) {
    const blockContainer = btn.closest('.code-block-container');
    const langBadge = blockContainer.querySelector('.code-lang-badge');
    const codeEl = blockContainer.querySelector('code') || blockContainer.querySelector('pre');
    
    let ext = 'txt';
    const lang = langBadge ? langBadge.innerText.toLowerCase() : 'txt';
    const extMap = { python: 'py', javascript: 'js', html: 'html', css: 'css', json: 'json', cpp: 'cpp', c: 'c', java: 'java', typescript: 'ts' };
    if (extMap[lang]) ext = extMap[lang];

    if (codeEl) {
        const blob = new Blob([codeEl.innerText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `doxa_snippet_${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`Downloaded code snippet as .${ext}`);
    }
};

// --- Unified Message Sending Pipeline ---
async function sendMessage() {
    const textInput = isFirstMessage ? userInputWelcome : userInputActive;
    if (!textInput) return;
    const text = textInput.value.trim();
    
    if (!text && !currentAttachedFile) return;

    document.querySelectorAll('.attachment-menu').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.plus-btn').forEach(b => b.classList.remove('spinning'));

    if (isFirstMessage) {
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        if (chatContainer) chatContainer.style.display = 'flex';
        if (activeInputArea) activeInputArea.style.display = 'flex';
        isFirstMessage = false;

        const titleText = text ? (text.substring(0, 26) + (text.length > 26 ? '...' : '')) : (currentAttachedFile ? currentAttachedFile.name : "File Attachment");
        chatHistories.unshift({ id: currentChatId, title: titleText });
        saveStorage();
        renderSidebarHistory();
    }

    let userParts = [];
    if (text) userParts.push({ text: text });

    const userRowWrapper = document.createElement('div');
    userRowWrapper.className = 'message-row user-row';

    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'user-message';

    let displayUserText = text;
    if (currentAttachedFile) {
        const filePart = await fileToGenerativePart(currentAttachedFile);
        userParts.push(filePart);
        const fileDisplayName = currentAttachedFile.name;
        clearAttachedFile();
        displayUserText = `${text ? text + ' ' : ''}[Attached: ${fileDisplayName}]`;
    }

    userMsgDiv.innerHTML = `<div class="message-content">${displayUserText}</div>`;
    userRowWrapper.appendChild(userMsgDiv);
    chatContainer.appendChild(userRowWrapper);

    const userContentEl = userMsgDiv.querySelector('.message-content');
    makeCollapsible(userMsgDiv, userContentEl);
    
    if (typeof attachUserMessageActions === 'function') {
        attachUserMessageActions(userRowWrapper);
    }

    textInput.value = '';
    textInput.style.height = 'auto';

    currentChatHistory.push({ "role": "user", "parts": userParts });
    saveStorage();

    const aiRowWrapper = document.createElement('div');
    aiRowWrapper.className = 'message-row ai-row';

    const aiMsgDiv = document.createElement('div');
    aiMsgDiv.className = 'ai-message';
    aiMsgDiv.innerHTML = `
        <div class="tiny-thinking-container">
            <span class="tiny-dot dot-1"></span>
            <span class="tiny-dot dot-2"></span>
            <span class="tiny-dot dot-3"></span>
            <span class="ai-thinking-text" style="margin-left: 6px;">Doxa AI is processing response</span>
        </div>
    `;
    
    aiRowWrapper.appendChild(aiMsgDiv);
    chatContainer.appendChild(aiRowWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const endpoint = (currentAiMode === 'openai') ? '/api/openai-chat' : '/chat';

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: currentChatHistory, mode: currentAiMode })
        });

        if (!response.ok) throw new Error("Server communication fault");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiResponseText = "";

        aiMsgDiv.innerHTML = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            aiResponseText += chunk;
            
            const imageTagMatch = aiResponseText.match(/\[GENERATE_IMAGE:\s*(.*?)\]/);
            
            if (imageTagMatch) {
                const imagePrompt = imageTagMatch[1].trim();
                const cleanedText = aiResponseText.replace(imageTagMatch[0], "").trim();
                
                aiMsgDiv.innerHTML = `
                    <div class="message-content">
                        ${cleanedText ? `<p>${window.marked ? marked.parse(cleanedText) : cleanedText}</p>` : ''}
                        <p><em>Generating image: "${imagePrompt}" 🎨...</em></p>
                    </div>
                `;
                
                try {
                    const imgResponse = await fetch('/generate-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt: imagePrompt })
                    });
                    const imgData = await imgResponse.json();
                    
                    if (imgData.success) {
                        aiMsgDiv.innerHTML = `
                            <div class="message-content">
                                ${cleanedText ? `<p>${window.marked ? marked.parse(cleanedText) : cleanedText}</p>` : ''}
                                <p>${imgData.response_text}</p>
                                <img src="${imgData.image_url}" alt="${imagePrompt}" style="max-width: 100%; border-radius: 8px; margin-top: 8px;" />
                            </div>
                        `;
                        aiResponseText = cleanedText + `\n\n${imgData.response_text}\n\n![Generated Image](${imgData.image_url})`;
                    }
                } catch (imgErr) {
                    console.error("Context Image Gen Error:", imgErr);
                }
                break;
            } else {
                aiMsgDiv.innerHTML = `<div class="message-content">${window.marked ? marked.parse(aiResponseText) : aiResponseText}</div>`;
            }
            
            if (window.hljs) {
                aiMsgDiv.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
            }
            enhanceCodeBlocks(aiMsgDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        currentChatHistory.push({ "role": "model", "parts": [{ "text": aiResponseText }] });
        saveStorage();

        if (window.hljs) {
            aiMsgDiv.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
        enhanceCodeBlocks(aiMsgDiv);
    } catch (err) {
        console.error("Error:", err);
        aiMsgDiv.innerHTML = `<span style="color: #ff6b6b;">[Connection Error: Failed to reach backend generator.]</span>`;
        return;
    }

    const actionButtonsBar = document.createElement('div');
    actionButtonsBar.className = 'message-actions';
    actionButtonsBar.innerHTML = `
        <button class="action-btn" onclick="copyMessage(this)" title="Copy text">
            <span class="material-icons-outlined" style="font-size: 16px;">content_copy</span>
        </button>
        <button class="action-btn" onclick="regenerateMessage()" title="Regenerate">
            <span class="material-icons-outlined" style="font-size: 16px;">refresh</span>
        </button>
    `;
    aiRowWrapper.appendChild(actionButtonsBar);

    const activeTitle = chatHistories.find(h => h.id === currentChatId)?.title || 'New Chat';
    saveChatToServer(currentChatId, activeTitle, currentChatHistory);
    
    const isScrolledToBottom = chatContainer.scrollHeight - chatContainer.scrollTop <= chatContainer.clientHeight + 150;
    if (isScrolledToBottom) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// --- Action Helpers ---
function copyMessage(button) {
    const textContent = button.closest('.ai-row').querySelector('.ai-message').innerText;
    navigator.clipboard.writeText(textContent);
    showToast("Copied to clipboard!");
}

function regenerateMessage() {
    if (currentChatHistory.length > 1) {
        currentChatHistory.pop();
        if (chatContainer.lastChild) chatContainer.lastChild.remove();
        if (chatContainer.lastChild) chatContainer.lastChild.remove();
        sendMessage();
    }
}

// --- UI Restoration & Storage Management ---
function restoreUIState() {
    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (chatContainer) {
        chatContainer.style.display = 'flex';
        chatContainer.style.overflowY = 'auto';
        chatContainer.style.height = '100%';
    }
    if (activeInputArea) activeInputArea.style.display = 'flex';

    if (chatContainer) {
        chatContainer.innerHTML = '';
        currentChatHistory.forEach(msg => {
            const rowWrapper = document.createElement('div');
            rowWrapper.className = `message-row ${msg.role === 'user' ? 'user-row' : 'ai-row'}`;
            
            const msgDiv = document.createElement('div');
            msgDiv.className = msg.role === 'user' ? 'user-message' : 'ai-message';
            
            if (msg.role === 'model') {
                msgDiv.innerHTML = `<div class="message-content">${window.marked ? marked.parse(msg.parts[0].text) : msg.parts[0].text}</div>`;
                rowWrapper.appendChild(msgDiv);
                
                const actionButtonsBar = document.createElement('div');
                actionButtonsBar.className = 'message-actions';
                actionButtonsBar.innerHTML = `
                    <button class="action-btn" onclick="copyMessage(this)" title="Copy text">
                        <span class="material-icons-outlined" style="font-size: 16px;">content_copy</span>
                    </button>
                    <button class="action-btn" onclick="regenerateMessage()" title="Regenerate">
                        <span class="material-icons-outlined" style="font-size: 16px;">refresh</span>
                    </button>
                `;
                rowWrapper.appendChild(actionButtonsBar);
            } else {
                let userText = "";
                if (Array.isArray(msg.parts)) {
                    userText = msg.parts.map(p => p.text || (p.inlineData ? "[Attached File]" : "")).filter(Boolean).join(" ");
                } else {
                    userText = msg.parts[0].text;
                }
                msgDiv.innerHTML = `<div class="message-content">${userText}</div>`;
                rowWrapper.appendChild(msgDiv);
                const userContent = msgDiv.querySelector('.message-content');
                if (userContent) makeCollapsible(msgDiv, userContent);
            }
            chatContainer.appendChild(rowWrapper);
        });

        if (window.hljs) {
            chatContainer.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
        enhanceCodeBlocks(chatContainer);

        setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 50);
    }
}

function resetChat() {
    currentChatId = Date.now();
    isFirstMessage = true;
    currentAttachedFile = null;
    clearAttachedFile();
    
    currentChatHistory = [
        { "role": "model", "parts": [{ "text": "Doxa AI core is online. How can I assist you today?" }] }
    ];
    
    if (chatContainer) {
        chatContainer.innerHTML = '';
        chatContainer.style.display = 'none';
    }
    if (activeInputArea) activeInputArea.style.display = 'none';
    if (welcomeScreen) welcomeScreen.style.display = 'flex';
    
    if (userInputWelcome) userInputWelcome.value = '';
    if (userInputActive) {
        userInputActive.value = '';
        userInputActive.style.height = 'auto';
    }
    
    saveStorage();
    renderSidebarHistory();
}

function saveStorage() {
    activeStorage.setItem(storagePrefix + 'chat_histories', JSON.stringify(chatHistories));
    activeStorage.setItem(storagePrefix + 'current_chat_id', currentChatId);
    activeStorage.setItem(storagePrefix + `conv_${currentChatId}`, JSON.stringify(currentChatHistory));
    activeStorage.setItem(storagePrefix + `is_first_${currentChatId}`, isFirstMessage);
}

async function saveChatToServer(chatId, title, messages) {
    try {
        await fetch('/api/chat/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: String(chatId), title: title, messages: messages })
        });
    } catch (err) {
        console.error('Error saving chat to server:', err);
    }
}

async function loadServerChat(chatId) {
    try {
        const res = await fetch(`/api/chat/${chatId}`);
        const data = await res.json();
        if (data.success && data.chat) {
            currentChatId = chatId;
            currentChatHistory = data.chat.messages || [];
            isFirstMessage = false;
            saveStorage();
            renderSidebarHistory();
            restoreUIState();
        }
    } catch (err) {
        console.error('Failed to load chat from server:', err);
    }
}

function renderSidebarHistory() {
    if (!sidebarHistoryContainer) return;
    sidebarHistoryContainer.innerHTML = '';
    chatHistories.forEach(item => {
        const histDiv = document.createElement('div');
        histDiv.className = 'history-item';
        if (item.id === currentChatId && !isFirstMessage) {
            histDiv.style.backgroundColor = 'var(--bg-hover)';
            histDiv.style.color = 'var(--text-main)';
        }
        histDiv.innerHTML = `
            <span class="title">${item.title}</span>
            <button class="delete-hist" title="Delete thread">
                <span class="material-icons-outlined" style="font-size: 14px;">delete</span>
            </button>
        `;

        const deleteBtn = histDiv.querySelector('.delete-hist');
        if (deleteBtn) {
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                chatHistories = chatHistories.filter(h => h.id !== item.id);
                activeStorage.removeItem(storagePrefix + `conv_${item.id}`);
                activeStorage.removeItem(storagePrefix + `is_first_${item.id}`);
                saveStorage();
                renderSidebarHistory();
                if (currentChatId === item.id) resetChat();
            };
        }

        histDiv.onclick = () => {
            currentChatId = item.id;
            currentChatHistory = JSON.parse(activeStorage.getItem(storagePrefix + `conv_${currentChatId}`) || '[{"role": "model", "parts": [{"text": "Doxa AI core is online. How can I assist you today?"}]}]');
            isFirstMessage = false;
            saveStorage();
            renderSidebarHistory();
            restoreUIState();
        };
        sidebarHistoryContainer.appendChild(histDiv);
    });
}

window.toggleSidebarWithSpin = function(element) {
    toggleSidebar();
    const icon = element.querySelector('.material-icons-outlined');
    if (icon) {
        icon.classList.remove('spinning');
        void icon.offsetWidth; 
        icon.classList.add('spinning');
        setTimeout(() => {
            icon.classList.remove('spinning');
        }, 600);
    }
}

// --- User Message Actions Enhancement ---
function attachUserMessageActions(messageRow) {
    if (messageRow.dataset.actionsEnhanced) return;
    messageRow.dataset.actionsEnhanced = 'true';

    const userMsg = messageRow.querySelector('.user-message');
    if (!userMsg) return;

    if (messageRow.querySelector('.user-message-actions')) return;

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'user-message-actions';
    actionsContainer.innerHTML = `
        <button class="user-action-btn" onclick="copyUserMessage(this)" title="Copy text">
            <span class="material-icons-outlined">content_copy</span>
        </button>
        <button class="user-action-btn" onclick="enableMessageEdit(this)" title="Edit text">
            <span class="material-icons-outlined">edit</span>
        </button>
    `;
    messageRow.appendChild(actionsContainer);
}

function refreshAllUserMessageActions() {
    document.querySelectorAll('.user-row').forEach(row => {
        attachUserMessageActions(row);
    });
}

const originalRestoreUIState = window.restoreUIState;
window.restoreUIState = function() {
    if (typeof originalRestoreUIState === 'function') originalRestoreUIState();
    setTimeout(refreshAllUserMessageActions, 50);
};

document.addEventListener('DOMContentLoaded', refreshAllUserMessageActions);

window.copyUserMessage = function(btn) {
    const row = btn.closest('.user-row');
    const contentEl = row.querySelector('.message-content') || row.querySelector('.user-message');
    if (contentEl) {
        navigator.clipboard.writeText(contentEl.innerText);
        const iconSpan = btn.querySelector('.material-icons-outlined');
        const originalIcon = iconSpan.innerText;
        iconSpan.innerText = 'check';
        setTimeout(() => {
            iconSpan.innerText = originalIcon;
        }, 2000);
    }
};

window.enableMessageEdit = function(btn) {
    const row = btn.closest('.user-row');
    const userMsg = row.querySelector('.user-message');
    const contentEl = row.querySelector('.message-content') || userMsg;
    
    if (userMsg.classList.contains('editing')) return;

    const originalText = contentEl.innerText;
    userMsg.classList.add('editing');
    
    userMsg.innerHTML = `
        <textarea class="edit-textarea">${originalText}</textarea>
        <div class="edit-actions-bar">
            <button class="edit-cancel-btn" type="button" onclick="cancelMessageEdit(this, \`${originalText.replace(/`/g, '\\`').replace(/"/g, '&quot;')}\`)">Cancel</button>
            <button class="edit-update-btn" type="button" onclick="submitMessageEdit(this)">Update</button>
        </div>
    `;
    
    const textarea = userMsg.querySelector('textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight) + 'px';
    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
};

window.cancelMessageEdit = function(btn, originalText) {
    const userMsg = btn.closest('.user-message');
    userMsg.classList.remove('editing');
    userMsg.innerHTML = `<div class="message-content">${originalText}</div>`;
};

window.submitMessageEdit = function(btn) {
    const userMsg = btn.closest('.user-message');
    const textarea = userMsg.querySelector('textarea');
    if (!textarea) return;
    
    const newText = textarea.value.trim();
    if (!newText) {
        showToast("Message cannot be empty.");
        return;
    }

    const row = userMsg.closest('.user-row');
    const allUserRows = Array.from(chatContainer.querySelectorAll('.user-row'));
    const messageIndex = allUserRows.indexOf(row);

    if (messageIndex === -1) return;

    let historyUserCount = 0;
    let targetHistoryIndex = -1;
    
    for (let i = 0; i < currentChatHistory.length; i++) {
        if (currentChatHistory[i].role === 'user') {
            if (historyUserCount === messageIndex) {
                targetHistoryIndex = i;
                break;
            }
            historyUserCount++;
        }
    }

    if (targetHistoryIndex === -1) return;

    currentChatHistory = currentChatHistory.slice(0, targetHistoryIndex);
    currentChatHistory.push({ "role": "user", "parts": [{ "text": newText }] });
    
    let nextEl = row.nextElementSibling;
    while (nextEl) {
        const toRemove = nextEl;
        nextEl = nextEl.nextElementSibling;
        toRemove.remove();
    }
    row.remove();

    saveStorage();
    triggerEditedMessageFlow(newText);
};

async function triggerEditedMessageFlow(text) {
    const userRowWrapper = document.createElement('div');
    userRowWrapper.className = 'message-row user-row';

    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'user-message';
    userMsgDiv.innerHTML = `<div class="message-content">${text}</div>`;
    userRowWrapper.appendChild(userMsgDiv);
    chatContainer.appendChild(userRowWrapper);

    const userContentEl = userMsgDiv.querySelector('.message-content');
    makeCollapsible(userMsgDiv, userContentEl);
    attachUserMessageActions(userRowWrapper);

    const aiRowWrapper = document.createElement('div');
    aiRowWrapper.className = 'message-row ai-row';

    const aiMsgDiv = document.createElement('div');
    aiMsgDiv.className = 'ai-message';
    aiMsgDiv.innerHTML = `
        <div class="tiny-thinking-container">
            <span class="tiny-dot dot-1"></span>
            <span class="tiny-dot dot-2"></span>
            <span class="tiny-dot dot-3"></span>
            <span class="ai-thinking-text" style="margin-left: 6px;">Doxa AI is processing response</span>
        </div>
    `;
    
    aiRowWrapper.appendChild(aiMsgDiv);
    chatContainer.appendChild(aiRowWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: currentChatHistory, mode: currentAiMode })
        });

        if (!response.ok) throw new Error("Server communication fault");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiResponseText = "";

        aiMsgDiv.innerHTML = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            aiResponseText += chunk;
            
            aiMsgDiv.innerHTML = `<div class="message-content">${window.marked ? marked.parse(aiResponseText) : aiResponseText}</div>`;
            
            if (window.hljs) {
                aiMsgDiv.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
            }
            enhanceCodeBlocks(aiMsgDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        currentChatHistory.push({ "role": "model", "parts": [{ "text": aiResponseText }] });
        saveStorage();

        if (window.hljs) {
            aiMsgDiv.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
        enhanceCodeBlocks(aiMsgDiv);
    } catch (err) {
        console.error("Error:", err);
        aiMsgDiv.innerHTML = `<span style="color: #ff6b6b;">[Connection Error: Failed to reach backend generator.]</span>`;
        return;
    }

    const actionButtonsBar = document.createElement('div');
    actionButtonsBar.className = 'message-actions';
    actionButtonsBar.innerHTML = `
        <button class="action-btn" onclick="copyMessage(this)" title="Copy text">
            <span class="material-icons-outlined" style="font-size: 16px;">content_copy</span>
        </button>
        <button class="action-btn" onclick="regenerateMessage()" title="Regenerate">
            <span class="material-icons-outlined" style="font-size: 16px;">refresh</span>
        </button>
    `;
    aiRowWrapper.appendChild(actionButtonsBar);

    const activeTitle = chatHistories.find(h => h.id === currentChatId)?.title || 'New Chat';
    saveChatToServer(currentChatId, activeTitle, currentChatHistory);
    
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Dedicated Logout Handler for Guests ---
window.triggerLogout = function() {
    if (isGuestUser) {
        const guestTabId = sessionStorage.getItem("doxa_guest_tab_id");
        if (guestTabId) {
            Object.keys(sessionStorage).forEach(key => {
                if (key.includes(guestTabId)) {
                    sessionStorage.removeItem(key);
                }
            });
            sessionStorage.removeItem("doxa_guest_tab_id");
        }
    }
    window.location.href = "/logout";
};

// --- Additional Utilities ---
const shimmerStyle = document.createElement('style');
shimmerStyle.innerHTML = `
    @keyframes gemini-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }
    .doxa-image-wrapper img.loaded {
        display: block !important;
    }
`;
document.head.appendChild(shimmerStyle);
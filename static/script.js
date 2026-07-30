// --- Global State & Initialization ---
hljs.highlightAll();
const currentUsername = document.querySelector('.username-display')?.textContent?.trim() || "default_user";
const storagePrefix = `doxa_${currentUsername}_`;

let chatHistories = JSON.parse(localStorage.getItem(storagePrefix + 'chat_histories') || '[]');
let currentChatId = Number(localStorage.getItem(storagePrefix + 'current_chat_id')) || Date.now();

let currentChatHistory = JSON.parse(localStorage.getItem(storagePrefix + `conv_${currentChatId}`) || JSON.stringify([
    { "role": "model", "parts": [{ "text": "Doxa AI core is online. How can I assist you today?" }] }
]));

let isFirstMessage = localStorage.getItem(storagePrefix + `is_first_${currentChatId}`) !== 'false' && currentChatHistory.length <= 1;
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
                    const isExpanded = contentElement.classList.toggle('expanded');
                    contentElement.classList.toggle('clamped', !isExpanded);
                    toggleBtn.innerText = isExpanded ? 'Read Less' : 'Read More';
                };
                
                wrapper.appendChild(toggleBtn);
            }
        }
    }, 50);
}

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

    textInput.value = '';
    textInput.style.height = 'auto';

    currentChatHistory.push({ "role": "user", "parts": userParts });
    saveStorage();

    const aiRowWrapper = document.createElement('div');
    aiRowWrapper.className = 'message-row ai-row';

    const aiMsgDiv = document.createElement('div');
    aiMsgDiv.className = 'ai-message';
    aiMsgDiv.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Doxa AI is thinking...</p>`;
    
    aiRowWrapper.appendChild(aiMsgDiv);
    chatContainer.appendChild(aiRowWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Standard Text Streaming Pipeline
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
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        currentChatHistory.push({ "role": "model", "parts": [{ "text": aiResponseText }] });
        saveStorage();

        const finalContentEl = aiMsgDiv.querySelector('.message-content');
        makeCollapsible(aiMsgDiv, finalContentEl);

        if (window.hljs) {
            document.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }
    } catch (err) {
        console.error("Error:", err);
        aiMsgDiv.innerHTML = `<span style="color: #ff6b6b;">[Connection Error: Failed to reach backend generator.]</span>`;
        return;
    }

    // Append action buttons bar
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
                
                // Action buttons bar preserved ONLY for AI responses
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
                msgDiv.innerText = userText;
                rowWrapper.appendChild(msgDiv);
                // No action buttons or extra components attached to user rows
            }
            chatContainer.appendChild(rowWrapper);
        });

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
    localStorage.setItem(storagePrefix + 'chat_histories', JSON.stringify(chatHistories));
    localStorage.setItem(storagePrefix + 'current_chat_id', currentChatId);
    localStorage.setItem(storagePrefix + `conv_${currentChatId}`, JSON.stringify(currentChatHistory));
    localStorage.setItem(storagePrefix + `is_first_${currentChatId}`, isFirstMessage);
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
                localStorage.removeItem(storagePrefix + `conv_${item.id}`);
                localStorage.removeItem(storagePrefix + `is_first_${item.id}`);
                saveStorage();
                renderSidebarHistory();
                if (currentChatId === item.id) resetChat();
            };
        }

        histDiv.onclick = () => {
            currentChatId = item.id;
            currentChatHistory = JSON.parse(localStorage.getItem(storagePrefix + `conv_${currentChatId}`) || '[{"role": "model", "parts": [{"text": "Doxa AI core is online. How can I assist you today?"}]}]');
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
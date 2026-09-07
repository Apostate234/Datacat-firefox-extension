window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.direction !== "from-page-to-ext") return;
    chrome.runtime.sendMessage({ __from_datacat_bridge: true, payload: event.data.message }).then(response => {
        window.postMessage({ direction: "from-ext-to-page", messageId: event.data.messageId, response: response }, "*");
    }).catch(err => {
        window.postMessage({ direction: "from-ext-to-page", messageId: event.data.messageId, error: err.message }, "*");
    });
});

const script = document.createElement('script');
script.textContent = `
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.sendMessage = function(extensionId, message, options, responseCallback) {
        if (typeof extensionId !== 'string') {
            responseCallback = options;
            options = message;
            message = extensionId;
        }
        if (typeof options === 'function') responseCallback = options;
        
        const messageId = Math.random().toString(36).substring(2);
        if (responseCallback) {
            const listener = (event) => {
                if (event.source !== window || !event.data || event.data.direction !== 'from-ext-to-page' || event.data.messageId !== messageId) return;
                window.removeEventListener('message', listener);
                responseCallback(event.data.response);
            };
            window.addEventListener('message', listener);
        }
        window.postMessage({ direction: 'from-page-to-ext', message: message, messageId: messageId }, '*');
    };
`;
(document.head || document.documentElement).appendChild(script);
script.remove();

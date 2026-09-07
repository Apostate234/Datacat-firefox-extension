// This file intercepts internal messages and tricks the extension into
// thinking they came directly from the datacat.run website.
if (!chrome.runtime.onMessageExternal) {
    chrome.runtime.onMessageExternal = {
        listeners: [],
        addListener: function(listener) { this.listeners.push(listener); },
        removeListener: function(listener) { this.listeners = this.listeners.filter(l => l !== listener); },
        hasListener: function(listener) { return this.listeners.includes(listener); }
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.__from_datacat_bridge) {
            const mockSender = {
                url: sender.url || (sender.tab ? sender.tab.url : ""),
                origin: sender.origin || (sender.tab ? new URL(sender.tab.url).origin : ""),
                id: chrome.runtime.id,
                tab: sender.tab
            };
            
            let isAsync = false;
            for (const listener of chrome.runtime.onMessageExternal.listeners) {
                const result = listener(message.payload, mockSender, sendResponse);
                if (result === true) isAsync = true;
            }
            return isAsync;
        }
    });
}

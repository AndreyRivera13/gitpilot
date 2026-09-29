'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitpilot', {
  call: (method, args) => ipcRenderer.invoke('api', method, args),
  onEvent: (cb) => {
    const h = (_e, msg) => cb(msg.name, msg.payload);
    ipcRenderer.on('event', h);
    return () => ipcRenderer.removeListener('event', h);
  },
  onMenu: (cb) => {
    const h = (_e, action) => cb(action);
    ipcRenderer.on('menu', h);
    return () => ipcRenderer.removeListener('menu', h);
  },
  platform: process.platform,
});

/**
 * Collection of "dumb" functions for modifying the DOM.
 */
import { breakText } from './utils.js';

// cached DOM elements
let textBox = document.body.getElementsByTagName('textarea')[0];

let publicChat = document.getElementsByClassName('messages')[0];
let privateChatsContainer = document.getElementById('private-chats-container');
let emptyMessage = document.getElementById('empty');
let privateChats = {};

let gameInfo = document.getElementById('game-info');

function hideLongText(text, fontSize='x-large') {
  let threshold = fontSize == 'x-large' ? 8 : 12;

  if (text.length > threshold) {
    return text.substring(0, threshold - 3) + '...';
  } else {
    return text;
  }
}

function matchFontSize(length) {
  if (length >= 12) {
    return 'large';
  } else {
    return 'x-large';
  }
}

function addTextBoxListener(event, handler) {
  textBox.addEventListener(event, handler);
}

function appendMessage(id, ...msgs) {
  let messages = [];

  for (let i in msgs) {
      let {text, from, race} = msgs[i];

      let sentences = text.split('\n');
      let numNewlines = sentences.length - 1;
    
      for (let i = 0; i < sentences.length; i++) {
        let broken = breakText(sentences[i], 65);
        sentences[i] = broken.text;
        numNewlines += broken.numNewlines;
      }
    
      text = sentences.join('\n');
    
      let carrots = ['>'];
      for (let i = 0; i < numNewlines; i++) {
        carrots.push('>');
      }
    
      let container = document.createElement('DIV');
      container.className = 'message';
    
      let sender = document.createElement('DIV');
      sender.className = 'sender';
      sender.style.fontSize = matchFontSize(from.length);
      sender.style.color = race == 'BOT' ? 'var(--bot-color)' : 'var(--handle-color)';
      sender.innerHTML = hideLongText(from, sender.style.fontSize);
      
      let carrot = document.createElement('DIV');
      carrot.className = 'carrot';
      carrot.innerHTML = carrots.join('\n');
      carrot.style.color = race == 'BOT' ? 'var(--bot-color)' : 'black';
      carrot.id = 'carrot';
    
      let body = document.createElement('P');
      body.className = 'multiline';
      text = text.replace(/\n/g, '<br>');
      body.innerHTML = text;
      body.style.color = race == 'BOT' ? 'var(--bot-color)' : 'black';
    
      container.appendChild(sender);
      container.appendChild(carrot);
      container.appendChild(body);

      messages.push(container);
  }

  if (id == 'public') {
    publicChat.prepend(...(messages.reverse()));
  } else {
    privateChats[id].getElementsByClassName('messages')[0].prepend(...(messages.reverse()));
  }
}

function addPrivateChannel(id, me, other, readonly, textBoxListeners) {
  if (Object.keys(privateChats).length == 0) {
    privateChatsContainer.removeChild(emptyMessage);

    privateChatsContainer.style.alignItems = 'flex-start';
    privateChatsContainer.style.justifyContent = 'flex-start';
  }

  let container = document.createElement('DIV');
  container.className = 'private-chat-window';

  let status = document.createElement('DIV');
  status.className = 'private-chat-status';
  status.innerHTML = other; // indicate who I'm sending messages to

  let messages = document.createElement('DIV');
  messages.className = 'messages';

  let textBox = document.createElement('DIV');
  textBox.className = 'text-box';

  // build handle
  let handleContainer = document.createElement('DIV');
  handleContainer.className = 'handle-container';

  let handle = document.createElement('P');
  handle.className = 'handle';
  handle.style.fontSize = matchFontSize(me.length);
  handle.innerHTML = hideLongText(me, handle.style.fontSize);
  handleContainer.appendChild(handle);

  // build prompt
  let prompt = document.createElement('DIV');
  prompt.className = 'prompt';
  prompt.innerHTML = '&gt;';

  let textarea = document.createElement('TEXTAREA');
  textarea.rows = 1;

  textBox.appendChild(handleContainer);
  textBox.appendChild(prompt);
  textBox.appendChild(textarea);

  container.appendChild(status);
  container.appendChild(messages);

  if (!readonly) {
    for (let e of Object.keys(textBoxListeners)) {
      textarea.addEventListener(e, textBoxListeners[e]);
    } 

    container.appendChild(textBox);
  }

  privateChatsContainer.appendChild(container);
  privateChats[id] = container;
}

function deletePrivateChannel(id) {
  privateChats[id].remove();
  delete privateChats[id];

  if (Object.keys(privateChats).length == 0) {
    privateChatsContainer.appendChild(emptyMessage);

    privateChatsContainer.style.alignItems = 'center';
    privateChatsContainer.style.justifyContent = 'center';
  } 
}

function setChannelOffline(id) {
  privateChats[id].getElementsByClassName('private-chat-status')[0].style['background-color'] = 'red';
}

function updateGameInfo(roomName, players) {
  let display =  `[${roomName}]\n` + players.join('\n');

  if (display != gameInfo.innerHTML) {
    gameInfo.innerHTML = display;
  }
}

function setHandle(name) {
  let handle = document.getElementsByClassName('handle')[0];

  handle.style.fontSize = matchFontSize(name.length);
  handle.innerHTML = hideLongText(name, handle.style.fontSize);
}

function reset() {
  let first = publicChat.firstElementChild;
  while (first) {
    first.remove();
    first = publicChat.firstElementChild; 
  }
  
  for (let c of Object.keys(privateChats)) {
    privateChats[c].remove();
    delete privateChats[c];
  }
}

const view = {
  addTextBoxListener,
  appendMessage,
  addPrivateChannel,
  deletePrivateChannel,
  setChannelOffline,
  updateGameInfo,
  setHandle,
  reset,
};

export default view;
  
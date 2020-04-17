/**
 * "Dumb" functions for modifying the DOM.
 */
import { breakText } from './utils.js';

// cached DOM elements
let textBox = document.body.getElementsByTagName('textarea')[0];
let publicChat = document.getElementsByClassName('messages')[0];
let gameInfo = document.getElementById('game-info');

let privateChats = {};

function addTextBoxListener(event, handler) {
  textBox.addEventListener(event, handler);
}

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

function appendTextMessage(id, ...msgs) {
  if (id == 'public') {
    appendPublic(...msgs);
  } else {
    appendPrivate(id, ...msgs);
  }
}

function appendPublic(...msgs) {
    let messages = [];

    for (let i in msgs) {
        let {text, from, race} = msgs[i];

        let sentences = text.split('\n');
        let numNewlines = sentences.length - 1;
      
        for (let i = 0; i < sentences.length; i++) {
          let broken = breakText(sentences[i], 80);
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
      
        let handle = document.createElement('DIV');
        handle.className = 'handle';
        handle.style.fontSize = matchFontSize(from.length);
        handle.style.color = race == 'BOT' ? 'blue' : 'orange';
        handle.innerHTML = hideLongText(from, handle.style.fontSize);
        
        let carrot = document.createElement('DIV');
        carrot.className = 'carrot';
        carrot.innerHTML = carrots.join('\n');
        carrot.style.color = race == 'BOT' ? 'blue' : 'black';
        carrot.id = 'carrot';
      
        let body = document.createElement('P');
        body.className = 'multiline';
        text = text.replace(/\n/g, '<br>');
        body.innerHTML = text;
        body.style.color = race == 'BOT' ? 'blue' : 'black';
      
        container.appendChild(handle);
        container.appendChild(carrot);
        container.appendChild(body);

        messages.push(container);
    }

    publicChat.prepend(...(messages.reverse()));
}

function displayGame(roomName, players) {
  let display =  `[${roomName}]\n` + players.join('\n');

  if (display != gameInfo.innerHTML) {
    gameInfo.innerHTML = display;
  }
}

function setName(name) {
  document.getElementsByClassName('name')[0].innerHTML = hideLongText(name);
}

function addPrivateChannel(id, me, other, readonly, textBoxListeners) {
  let container = document.createElement('DIV');
  container.className = 'private-chat';

  let displayName = document.createElement('DIV');
  displayName.className = 'display-name';
  displayName.innerHTML = other;

  let messages = document.createElement('DIV');
  messages.className = 'messages';

  let textBox = document.createElement('DIV');
  textBox.className = 'text-box';

  let nameContainer = document.createElement('DIV');
  nameContainer.className = 'name-container';
  let name = document.createElement('P');
  name.className = 'name';
  name.style['font-size'] = matchFontSize(me.length);
  name.innerHTML = hideLongText(me, name.style.fontSize);
  nameContainer.appendChild(name);

  let prompt = document.createElement('DIV');
  prompt.className = 'prompt';
  prompt.innerHTML = '&gt;';
  prompt.style['font-size'] = 'large';

  let textarea = document.createElement('TEXTAREA');
  textarea.rows = 1;

  textBox.appendChild(nameContainer);
  textBox.appendChild(prompt);
  textBox.appendChild(textarea);

  container.appendChild(displayName);
  container.appendChild(messages);

  if (!readonly) {
    for (let e of Object.keys(textBoxListeners)) {
      textarea.addEventListener(e, textBoxListeners[e]);
    } 

    container.appendChild(textBox);
  }

  document.getElementById('private-chats').appendChild(container);
  privateChats[id] = container;
}

function appendPrivate(channelId, ...msgs) {
  let messages = [];

  for (let i in msgs) {
      let {text, from, race} = msgs[i];

      let sentences = text.split('\n');
      let numNewlines = sentences.length - 1;
    
      for (let i = 0; i < sentences.length; i++) {
        let broken = breakText(sentences[i], 70);
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
    
      let handle = document.createElement('DIV');
      handle.className = 'handle';
      handle.style.fontSize = matchFontSize(from.length);
      handle.style.color = race == 'BOT' ? 'blue' : 'orange';
      handle.innerHTML = hideLongText(from, handle.style.fontSize);
      
      let carrot = document.createElement('DIV');
      carrot.className = 'carrot';
      carrot.innerHTML = carrots.join('\n');
      carrot.style.color = race == 'BOT' ? 'blue' : 'black';
      carrot.id = 'carrot';
      carrot.style['font-size'] = 'large';
    
      let body = document.createElement('P');
      body.className = 'multiline';
      text = text.replace(/\n/g, '<br>');
      body.innerHTML = text;
      body.style.color = race == 'BOT' ? 'blue' : 'black';
      body.style['font-size'] = 'large';
    
      container.appendChild(handle);
      container.appendChild(carrot);
      container.appendChild(body);

      messages.push(container);
  }

  privateChats[channelId].getElementsByClassName('messages')[0].prepend(...(messages.reverse()));
}

function startFresh() {
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

function deletePrivateChannel(id) {
  privateChats[id].remove();
  delete privateChats[id];
}

function setOffline(id) {
  console.log(privateChats[id].getElementsByClassName('display-name')[0]);
  privateChats[id].getElementsByClassName('display-name')[0].style['background-color'] = 'red';
}

const view = {
  addTextBoxListener,
  appendTextMessage,
  displayGame,
  setName,
  addPrivateChannel,
  setOffline,
  startFresh,
  deletePrivateChannel
};

export default view;
  
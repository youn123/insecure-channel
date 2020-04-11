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
        handle.innerHTML = from;
        handle.style.color = race == 'BOT' ? 'blue' : 'orange';
        
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
  gameInfo.innerHTML = `room: [${roomName}]\n` + players.join('\n');
}

function setName(name) {
  let names = document.getElementsByClassName('name');
  for (let i = 0; i < names.length; i++) {
    names[i].innerHTML = name;
  }
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
  name.innerHTML = me;
  nameContainer.appendChild(name);

  let prompt = document.createElement('DIV');
  prompt.className = 'prompt';
  prompt.innerHTML = '&gt;';

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
      handle.innerHTML = from;
      handle.style.color = race == 'BOT' ? 'blue' : 'orange';
      
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

  privateChats[channelId].getElementsByClassName('messages')[0].prepend(...(messages.reverse()));
}

const view = {
  addTextBoxListener,
  appendPublic,
  displayGame,
  setName,
  addPrivateChannel,
  appendPrivate
};

export default view;
  
console.log('hello world!');
// console.log(document.body);

// for (let i = 0; i < document.body.children.length; i++) {
//   console.log(document.body.children[i]);
// }

// Node states
const NEW = 0;
const JOINING = 1;
const JOINED_BUT_NO_NAME = 2;
const JOINED = 3;
const IN_GAME = 4;

class Game {
  constructor(roomName, state={version: 0, players: [], messages: []}) {
    this.roomName = roomName;
    this.playerName = null;
    this.state = state;
    this.page = 0;
  }

  async poll() {
    while (true) {
      await this.fetchState().then(responseJson => {
        let oldState = this.state;

        this.state = responseJson;
        this.page += responseJson.messages.length;
        this.updateUI(oldState);
      });
    }
  }

  fetchState() {
    let url = this.playerName ? `/rooms/${this.roomName}?page=${this.page}&from=${this.playerName}`
        : `/rooms/${this.roomName}`;

    return fetch(url, {
        headers: {
          ['if-none-match'] : this.state.version,
          prefer: 'wait=100'
        }
      })  
      .then(response => response.json());
  }

  updateUI(oldState) {
    if (!oldState || (oldState && !arrayEquals(oldState.players, this.state.players))) {
      names.innerHTML = this.state.players.join('\n');
    }

    // this.state.messages.forEach(msg => console.log(msg));
    chatHistory.prepend(...(this.state.messages.map(msg => message(msg.text, msg.from, msg.type=='BOT')).reverse()));
  }

  sendMsg(text) {
    fetch(`/rooms/${this.roomName}/chat`, {
      method: 'POST',
      body: JSON.stringify({text: text, from: this.playerName, type: 'HUMAN'})
    })
      .catch(error => bot(error.message));
  }
}

let state = NEW;
let game;

// DOM elements here
let textBox = document.body.getElementsByTagName('textarea')[0];
let chatHistory = document.getElementById('chat-container');
let names = document.getElementById('names');

// keep track of keys pressed down and newlines added
let keysPressedDown = {};

// register commands here
let commands = {};

commands['/new'] = function(...args) {
  if (state != NEW) {
    bot("You can't create a game while being in one.");
    return;
  }

  fetch(`/rooms/${args[0]}`, {
    method: 'POST'
  })
    .then(async response => {
      if (response.status != 201) {
        throw new Error(await response.text());
      }

      state = JOINED_BUT_NO_NAME;
      game = new Game(args[0]);
      bot(NAME);
      game.poll();
    })
    .catch(error => bot(error.message));
};

commands['/join'] = function(...args) {
  if (state != NEW) {
    bot("You can't join a game while being in one.");
    return;
  }

  state = JOINING;
  bot(`Joining ${args[0]}, please wait...`);

  fetch(`/rooms/${args[0]}`)
    .then(async response => {
      if (response.status != 200) {
        state = NEW;
        throw new Error(await response.text());
      }

      state = JOINED_BUT_NO_NAME;
      return response.json();
    })
    .then(responseJson => {
      game = new Game(args[0], responseJson);
      game.updateUI();
      bot(NAME);

      game.poll();
    })
    .catch(error => {
      bot(error.message);
    });
}

commands['/me'] = function(...args) {
  if (state != JOINED_BUT_NO_NAME) {
    bot('You cannot set your name before joining a game or midgame.');
    return;
  } else if (game.playerName) {
    bot('You cannot change your name.');
    return;
  }

  fetch(`/rooms/${game.roomName}/players`, {
    method: 'POST',
    body: args[0]
  })
    .then(async response => {
      if (response.status != 201) {
        throw new Error(await response.text());
      }

      state = JOINED;
      game.playerName = args[0];
      document.getElementById('name').innerHTML = args[0];
      fetch(`/rooms/${game.roomName}/ping`); // alert itself of the new name
    })
    .catch(error => {
      bot(error.message);
    });
}

textBox.addEventListener('keydown', function(e) {
  keysPressedDown[e.key] = true;

  if (keysPressedDown['Backspace']) {
    if (textBox.value[textBox.value.length - 1] === '\n') {
      textBox.rows--;
    }
  } else if (keysPressedDown['Enter']) {
    if (!keysPressedDown['Shift']) {
      e.preventDefault();

      if (textBox.value[0] === '/') {
        handleCommand(textBox.value);

        textBox.value = '';
        textBox.rows = 1;
        return;
      }

      switch (state) {
        case JOINED_BUT_NO_NAME:
          bot(NAME);
          break;
        case JOINED:
        case IN_GAME:
          game.sendMsg(textBox.value);
          break;
        case NEW:
        case JOINING:
          // TODO
          chatHistory.append(message(textBox.value, '...'));
          break;
      }

      textBox.value = '';
      textBox.rows = 1;
    } else {
      textBox.rows = Math.min(5, textBox.rows + 1);
    }
  }
});

textBox.addEventListener('keyup', function(e) {
  keysPressedDown[e.key] = false;
});

chatHistory.addEventListener('scroll', function(e) {
  // TODO: optimization possible here
  // console.log(chatHistory.scrollTop);
});

function message(text, from, bot=false) {
  let sentences = text.split('\n');
  let numNewlines = sentences.length - 1;

  for (let i = 0; i < sentences.length; i++) {
    let broken = breakText(sentences[i], 50);
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

  let handle = document.createElement('P');
  handle.innerHTML = from;
  handle.className = bot ? 'bothandle' : 'handle';
  
  let carrot = document.createElement('DIV');
  carrot.innerHTML = carrots.join('\n');
  carrot.className = bot ? 'botcarrot' : 'carrot';
  carrot.id = 'carrot';

  let body = document.createElement('P');
  text = text.replace(/\n/g, '<br>');
  body.innerHTML = text;
  body.className =bot ? 'botmultiline' : 'multiline';

  container.appendChild(handle);
  container.appendChild(carrot);
  container.appendChild(body);

  return container;
}

function handleCommand(text) {
  let args = text.split(' ');
  let c = args.shift();
  if (c in commands) {
    commands[c](...args);
  } else {
    bot(COMMAND_NOT_RECOGNIZED);
  }
}


function bot(text) {
  chatHistory.prepend(message(text, '*', true));
}

bot(INTRO);







import view from './view.js';
import { INTRO, NAME, COMMAND_NOT_RECOGNIZED } from './bot-messages.js';

// possible client states
const NEW = 0;
const JOINING = 1;
const JOINED_BUT_NO_NAME = 2;
const JOINED = 3;
const IN_GAME = 4;

let state = NEW;
let game;

// keep track of keys pressed down here
let keysPressedDown = {};

// register commands here
let publicCommands = {};
let privateCommands = {};

function bot(text, channelId='public') {
  let msg = {text: text, from: '*', race: 'BOT'};

  if (channelId == 'public') {
    view.appendPublic(msg);
  } else {
    view.appendPrivate(channelId, msg);
  }
}

function channelId(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

bot(INTRO);

class Game {
  constructor(roomName) {
    this.roomName = roomName;
    this.myName = null;

    this.version = 0;
    this.players = [];

    this.channels = {
      public: {
        messages: [],
        numReceived: 0,
        id: 'public'
      }
    };
  }

  async run() {
    while (true) {
      await this.fetchGameData()
        .then(responseJson => {
          console.log(responseJson);

          // extract & untag data
          let type = responseJson.type;
          delete responseJson.type;

          switch (type) {
            case 'NEW_MESSAGES':
              for (let c of Object.keys(responseJson)) {
                this.channels[c].messages.push(...responseJson[c]);
                this.channels[c].numReceived += responseJson[c].length;
              }
              break;
            case 'GAME_STATE_CHANGE':
              this.players = responseJson.players;
              this.version = responseJson.version;
              break;
            case 'NEW_CHANNEL':
              let id = channelId(this.myName, responseJson.other);
              console.log('new private channel:', id);

              view.addPrivateChannel(id, this.myName, responseJson.other, false, {
                keydown: textKeyDownListenerFactory(privateCommands, {
                  onSubmit: text => this.sendMsg(text, responseJson.other),
                  channelId: id
                }),
                keyup: function(e) {
                  keysPressedDown[e.key] = false;
                }
              });
            default:
              break;
          }

          this.updateUI();
        });
    }
  }

  fetchGameData() {
    let url = `/rooms/${this.roomName}`;

    // if name assigned...
    if (this.myName) {
      // start listening on public
      url += `?from=${this.myName}&channels=${this.channelQueryParam()}`;
    }

    return fetch(url, {
        headers: {
          ['if-none-match'] : this.version,
          prefer: 'wait=100'
        }
      })  
      .then(response => response.json());
  }

  channelQueryParam() {
    let channelIds = Object.keys(this.channels);

    return channelIds.reduce((total, cur, i) => {
      total += `${cur}:${this.channels[cur].numReceived}`;

      if (i != channelIds.length - 1) {
        total += ',';
      }

      return total;
    }, '');
  }

  updateUI() {
    view.displayGame(this.roomName, this.players);
    view.appendPublic(...this.channels.public.messages);
    this.channels.public.messages = []; // clear
  }

  sendMsg(text, to='everyone') {
    fetch(`/rooms/${this.roomName}/messages`, {
      method: 'POST',
      body: JSON.stringify({text: text, from: this.myName, to: to, race: 'HUMAN'})
    })
      .catch(error => bot(error.message));
  }
}

publicCommands['/new'] = function(...args) {
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
      
      window.setTimeout(() => game.run(), 5);
    })
    .catch(error => bot(error.message));
};

publicCommands['/join'] = function(...args) {
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
      console.log(responseJson);

      game = new Game(args[0]);
      game.players = responseJson.players;
      game.version = responseJson.version;

      view.displayGame(args[0], game.players);
      bot(NAME);
      window.setTimeout(() => game.run(), 5);
    })
    .catch(error => {
      bot(error.message);
    });
}

publicCommands['/me'] = function(...args) {
  if (state != JOINED_BUT_NO_NAME) {
    bot('You cannot set your name before joining a game or midgame.');
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
      game.myName = args[0];
      view.setName(args[0]);

      // alert itself of the new name
      fetch(`/rooms/${game.roomName}/ping`);
    })
    .catch(error => {
      bot(error.message);
    });
}

publicCommands['/dm'] = function(...args) {
  if (state != JOINED) {
    bot('no');
    return;
  }

  fetch(`/rooms/${game.roomName}/channels?from=${game.myName}&to=${args[0]}`, {
    method: 'POST'
  })
    .then(async response => {
      if (response.status != 201) {
        throw new Error(await response.text());
      }
    })
    .catch(error => {
      bot(error.message);
    });
}

privateCommands['/echo'] = function(...args) {
  console.log(this);
  bot(this.channelId, this.channelId);
}

function textKeyDownListenerFactory(commands, context) {
  function handleCommand(text) {
    let args = text.split(' ');
    let c = args.shift();
    if (c in commands) {
      if (context) {
        commands[c].call(context, ...args);
      } else {
        commands[c](...args);
      }
    } else {
      bot(COMMAND_NOT_RECOGNIZED, context.channelId);
    }
  }

  return function(e) {
    keysPressedDown[e.key] = true;

    if (keysPressedDown['Backspace']) {
      if (this.value[this.value.length - 1] === '\n') {
        this.rows--;
      }
    } else if (keysPressedDown['Enter']) {
      if (!keysPressedDown['Shift']) {
        e.preventDefault();
  
        if (this.value[0] === '/') {
          handleCommand(this.value);
  
          this.value = '';
          this.rows = 1;
          return;
        }
  
        switch (state) {
          case JOINED_BUT_NO_NAME:
            bot(NAME);
            break;
          case JOINED:
          case IN_GAME:
            context.onSubmit(this.value);
            break;
          case NEW:
          case JOINING:
            view.appendPublic({text: this.value, from: '...', race: 'HUMAN'});
            break;
        }
  
        this.value = '';
        this.rows = 1;
      } else {
        this.rows = Math.min(5, this.rows + 1);
      }
    }
  };
}

view.addTextBoxListener('keydown', textKeyDownListenerFactory(publicCommands, {
  onSubmit: text => game.sendMsg(text),
  channelId: 'public'
}));

view.addTextBoxListener('keyup', function(e) {
  keysPressedDown[e.key] = false;
});
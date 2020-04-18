import view from './view.js';
import {
  INTRO,
  NAME_YOURSELF,
  COMMAND_NOT_RECOGNIZED,
  CANNOT_CREATE_NEW
} from './bot-messages.js';

// client states
const NEW = 0;
const JOINING = 1;
const JOINED_BUT_NO_NAME = 2;
const JOINED = 3;
const IN_GAME = 4;

const identifierPat = /^[a-zA-Z0-9]+$/;

const identiferBlackList = new Set([
  'public',
  'everyone'
]);

let state = NEW;
let game;

// keep track of keys pressed down here
let keysPressedDown = {};

// commands you can run from public chat
let publicCommands = {};
// commands you can run from private chats
let privateCommands = {};

function bot(text, channelId='public') {
  view.appendMessage(
    channelId,
    {text: text, from: '*', race: 'BOT'}
  );
}

bot(INTRO);

class Game {
  constructor(roomName) {
    this.roomName = roomName;
    this.myName = null;
    this.players = [];

    this.channels = {
      public: new Channel('public', 'broadcast')
    };

    this.running = true; // volatile?
  }

  async run() {
    while (this.running) {
      await this.fetchData()
        .then(async response => {
          if (response.status == 201 || response.status == 200) {
            let body = await response.text();
            return body;
          }

          let error = new Error();
          error.statusCode = response.status;

          if (response.statusCode == 409) {
            error.message = await response.text();
          }

          throw error; 
        })
        .then(responseJson => {
          responseJson = JSON.parse(responseJson);

          // extract & untag data
          let type = responseJson.type;
          delete responseJson.type;

          switch (type) {
            case 'NEW_MESSAGES':
              for (let c of Object.keys(responseJson)) {
                this.channels[c].pushMessages(responseJson[c]);
              }
              break;
            case 'ALERT':
              for (let alert of responseJson.alerts) {
                switch (alert.code) {
                  case 'NEW_CHANNEL':
                    let channelId = alert.id;

                    this.channels[channelId] = new Channel(channelId, 'narrowcast', new Set(alert.members));

                    view.addPrivateChannel(channelId, this.myName, alert.other, false, {
                      keydown: textKeyDownListenerFactory(privateCommands, {
                        onSubmit: text => this.sendMsg(text, alert.other),
                        channelId: channelId,
                        other: alert.other
                      }),
                      keyup: function(e) {
                        keysPressedDown[e.key] = false;
                      }
                    });

                    break;
                  case 'DELETE_CHANNEL':
                    delete this.channels[alert.id];
                    view.deletePrivateChannel(alert.id);
                    break;
                  case 'PLAYER_JOIN':
                    this.players.push(alert.new);
                    view.updateGameInfo(this.roomName, this.players);
                    break;
                  case 'PLAYER_LEAVE':
                    this.players = this.players.filter(p => !alert.dead.includes(p));
                    view.updateGameInfo(this.roomName, this.players);

                    for (let d of alert.dead) {
                      for (let channel of Object.values(this.channels)) {
                        if (channel.id != 'public' && channel.members.has(d)) {
                          view.setChannelOffline(channel.id);
                        }
                      }
                    }
                    break;
                  default:
                    break;
                }
              }
              break;
          }

          if (!this.running) {
            return;
          }

          for (let channel of Object.values(this.channels)) {
            view.appendMessage(channel.id, ...channel.consumeMessages());
          }
        })
      .catch(error => {
        switch (error.statusCode) {
          case 204:
            break;
          default:
            bot('Server is down...PANICKING');
            this.running = false;
            break;
        }
      });
    }

    // TODO: clean up
    view.reset();
    game = null;

    state = NEW;
    bot(INTRO);
  }

  fetchData() {
    let url = `/rooms/${this.roomName}`;

    // if name assigned...
    if (this.myName) {
      // start listening on channels
      url += `?from=${this.myName}&channels=${this.channelQueryString()}`;
    }

    // long polling
    return fetch(url, {
      headers: {
        prefer: 'wait=100'
      }
    });
  }

  channelQueryString() {
    let channelIds = Object.keys(this.channels);

    return channelIds.reduce((total, cur, i) => {
      total += `${cur}:${this.channels[cur].numMessages}`;

      if (i != channelIds.length - 1) {
        total += ',';
      }

      return total;
    }, '');
  }

  sendMsg(text, to='everyone') {
    fetch(`/rooms/${this.roomName}/messages`, {
      method: 'POST',
      body: JSON.stringify({text: text, from: this.myName, to: to, race: 'HUMAN'})
    })
      .catch(error => bot(error.message));
  }
}

/**
 * Medium of communication.
 * 
 * Stores total sent messages, mode (broadcast or narrowcast), and
 * member list.
 */
class Channel {
  constructor(id, mode, members) {
      this.id = id;
      this.messages = [];
      this.mode = mode;
      this.numMessages = 0;

      if (this.mode == 'narrowcast') {
          this.members = members;
      }
  }

  pushMessages(messages) {
    this.messages = messages;
    this.numMessages += messages.length;
  }

  consumeMessages() {
    let temp = this.messages;
    this.messages = [];
    return temp;
  }
}

publicCommands['/new'] = function(...args) {
  if (state != NEW) {
    bot(CANNOT_CREATE_NEW);
    return;
  }

  if (!identifierPat.test(args[0])) {
    bot('Name of chatrooms must consist of letters or numbers only.\nPlease try another!');
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
      bot(NAME_YOURSELF);
      
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
      view.updateGameInfo(args[0], game.players);

      bot(NAME_YOURSELF);
      window.setTimeout(() => game.run(), 5);
    })
    .catch(error => {
      bot(error.message);
    });
}

publicCommands['/me'] = function(...args) {
  if (state != JOINED_BUT_NO_NAME) {
    bot('You cannot set your name before joining a room or after you have already named yourself.');
    return;
  }

  if (!identifierPat.test(args[0])) {
    bot('Name must consist of letters or numbers only.\nPlease try another!');
    return;
  }

  if (identiferBlackList.has(args[0])) {
    bot(`I'm sorry, '${args[0]}' is a reserved name.\nPlease try another!`);
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
      view.setHandle(args[0]);

      // alert itself of the new name...kind of whacky way of doing it
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

publicCommands['/leave'] = function(...args) {
  if (state != JOINED) {
    bot('no');
    return;
  }

  fetch(`/rooms/${game.roomName}/players`, {
    method: 'DELETE',
    body: game.myName
  })
    .then(async response => {
      if (response.status != 200) {
        throw new Error(await response.text());
      }

      state = NEW;
      game.running = false;

      // alert itself...kind of whacky way of doing it
      fetch(`/rooms/${game.roomName}/ping`);

    })
    .catch(error => {
      bot(error.message);
    });
}

privateCommands['/echo'] = function(...args) {
  console.log(this);
  bot(this.channelId, this.channelId);
}

privateCommands['/shred'] = function(...args) {
  fetch(`/rooms/${game.roomName}/channels?from=${game.myName}&to=${this.other}`, {
    method: 'DELETE'
  })
    .then(async response => {
      if (response.status != 201) {
        throw new Error(await response.text());
      }
      keysPressedDown['Enter'] = false;
    })
    .catch(error => {
      bot(error.message);
    });
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
            bot(NAME_YOURSELF);
            break;
          case JOINED:
          case IN_GAME:
            context.onSubmit(this.value);
            break;
          case NEW:
          case JOINING:
            view.appendMessage('public', {text: this.value, from: '...', race: 'HUMAN'});
            break;
        }
  
        this.value = '';
        this.rows = 1;
      } else {
        this.rows = Math.min(5, this.rows + 1);
      }
    }
  }
}

view.addTextBoxListener('keydown', textKeyDownListenerFactory(publicCommands, {
  onSubmit: text => game.sendMsg(text),
  channelId: 'public'
}));

view.addTextBoxListener('keyup', function(e) {
  keysPressedDown[e.key] = false;
});
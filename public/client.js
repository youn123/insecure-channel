console.log('hello world!');
// console.log(document.body);

// for (let i = 0; i < document.body.children.length; i++) {
//   console.log(document.body.children[i]);
// }

// Node states
const NEW = 0;
const JOINING = 1;
const JOINED = 2;
const IN_GAME = 3;

// WebRTC data codes
const NAME = 0;
const NAME_FAIL_DUP = 1;
const NAME_OK = 2;
const CHAT = 3;
const BOT_BROADCAST = 4;
const GAME_STATE = 5;
const HANDSHAKE = 6;

// using Google public stun server
const config = {
  iceServers: [{url: 'stun:stun2.1.google.com:19302'}]
};

// for peer (to connect to host). Not used by
// host.
let conn;
let host;

let nodeState = NEW;
let name;

class Host {
  constructor() {
    this.conns = {};
  }

  broadcast(data, ...exclude) {
    let dataJson = JSON.stringify(data);

    for (let peerId of Object.keys(this.conns)) {
      if (!exclude.includes(peerId)) {
        if (this.conns[peerId].dataChannel && this.conns[peerId].dataChannel.readyState == 'open') {
          this.conns[peerId].dataChannel.send(dataJson);
        }
      }
    }
  }

  narrowcast(data, ...include) {
    let dataJson = JSON.stringify(data);

    for (let peerId of Object.keys(this.conns)) {
      if (include.includes(peerId)) {
        this.conns[peerId].dataChannel.send(dataJson);
      }
    }
  }
}

let gameState = {
  started: false,
  roomName: '',
  names: [],
  code: GAME_STATE
};

let textBox = document.body.getElementsByTagName('textarea')[0];
let chatHistory = document.getElementById('chat-container');
let names = document.getElementById('names');

// keep track of keys pressed down and newlines added
let keysPressedDown = {};

// register commands here
let commands = {};

commands['/new'] = function(...args) {
  if (nodeState != NEW) {
    message("You can't create a game while being in one.", BOT, bot=true);
    return;
  }

  fetch(`/rooms/${args[0]}`, {
    method: 'POST'
  })
    .then(async response => {
      if (response.status != 201) {
        throw new Error(await response.text());
      }
      
      host = new Host();
      nodeState = JOINED;
      gameState.roomName = args[0];

      await waitForConnection(args[0]);
    })
    .catch(error => message(error.message, BOT, bot=true));
};

commands['/join'] = function(...args) {
  if (nodeState != NEW) {
    message("You can't join a game while being in one.", BOT, bot=true);
    return;
  }

  nodeState = JOINING;
  message(`Joining ${args[0]}, please wait...`, BOT, bot=true);

  fetch(`/rooms/${args[0]}`, {
    method: 'PUT'
  })
    .then(async response => {
      if (response.status == 201) {
        return response.json();
      } else {
        throw new Error(await response.text());
      }
    })
    .then(responseJson => {
      peerId = responseJson.peerId;
      signalHost(args[0], peerId)
    })
    .catch(error => {
      console.log(error.message);
    });
}

commands['/me'] = function(...args) {
  if (nodeState != JOINED) {
    message('You cannot set your name before joining a game or midgame.', BOT, bot=true);
  } else if (name) {
    message('(Only you can see this) You cannot change your name.', BOT, bot=true);
  } else {
    if (host) {
      if (args[0] in host.conns) {
        message(`${args[0]} already exists. Try another name.`, BOT, bot=true);
      } else {
        name = args[0];

        document.getElementById('name').innerHTML = name;
        message(`Welcome, <span class="mention">${name}</span>.`, BOT, bot=true);
        gameState.names.push(args[0]);
        updateNames();

        host.broadcast({payload: `Welcome, <span class="mention">${name}</span>.`, code: BOT_BROADCAST});
        host.broadcast(gameState);
      }
    } else {

      conn.dataChannel.send(JSON.stringify({payload: args[0], code: NAME}));
    }
  }
}

async function signalHost(roomName, peerId) {
  function send(data) {
    fetch(`/rooms/${roomName}?dest=0`, {
      method: 'PUT',
      body: JSON.stringify({peerId: peerId, payload: data}) // tag with peerId
    });
  }

  conn = new RTCPeerConnection(config, {optional: [{RtpDataChannels: true}]});

  conn.onicecandidate = function(e) {
    if (e.candidate && this.connectionState !== 'connected') {
      send(e.candidate);
    }
  }

  conn.dataChannel = conn.createDataChannel('messages', {reliable: true});
  conn.dataChannel.onmessage = handleRTCMessage;

  conn.dataChannel.onopen = function(e) {
    nodeState = JOINED;
    conn.dataChannel.send(JSON.stringify({code: HANDSHAKE}));
    message('Almost there! Before you can send messages, name yourself by entering\n\n<strong>/me [name]</strong>', BOT, bot=true);
  };
  
  conn.dataChannel.onerror = function(e) {
    console.log(e.message);
  }

  conn.createOffer().then(function(offer) {
    conn.setLocalDescription(offer);
    send(offer);
  });

  let answerReceived = false;
  let candidateReceived = false;

  while (conn.dataChannel.readyState != 'open') {
    await fetch(`/rooms/${roomName}?dest=${peerId}`, {
      headers: {
        prefer: 'wait=3'
      }
    })
      .then(response => response.json())
      .then(responseJson => {
        for (let data of responseJson) {
          data = JSON.parse(data);
      
          switch (data.type) {
            case 'answer':
              console.log('answer received');
              answerReceived = true;
              conn.setRemoteDescription(new RTCSessionDescription(data));
              break;
            default: // candidate
              console.log('candidate received');
              candidateReceived = true;
              conn.addIceCandidate(new RTCIceCandidate(data));
              break;
          }
        }
      });
  }
}

async function waitForConnection(roomName) {
  function send(data, dest) {
    fetch(`/rooms/${roomName}?dest=${dest}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  message('New room created.\n\nBefore you can send messages, name yourself by entering <strong>/me [name]</strong>', BOT, bot=true);
  while (!gameState.started) {
    await fetch(`/rooms/${roomName}?dest=0`, {
      headers: {
        prefer: 'wait=100'
      }
    })
      .then(response => response.json())
      .then(responseJson => {
        for (let data of responseJson) {
          data = JSON.parse(data);
          let peerId = data.peerId;

          switch (data.payload.type) {
            case 'offer':
              console.log('offer received');
              host.conns[peerId] = new RTCPeerConnection(config, {optional: [{RtpDataChannels: true}]});

              host.conns[peerId].onicecandidate = function(e) {
                if (e.candidate && this.connectionState !== 'connected') {
                  send(e.candidate, peerId);
                }
              };

              host.conns[peerId].ondatachannel = function(e) {
                host.conns[peerId].dataChannel = e.channel;
                host.conns[peerId].dataChannel.peerId = peerId;
                host.conns[peerId].dataChannel.onmessage = handleRTCMessageHost;
              }

              host.conns[peerId].setRemoteDescription(new RTCSessionDescription(data.payload))
                .catch(e => console.log(e.message));

              host.conns[peerId].createAnswer().then(answer => {
                host.conns[peerId].setLocalDescription(answer)
                  .catch(e => console.log(e.message));
                send(answer, peerId);
              });
            
              break;
            default:
              host.conns[peerId].addIceCandidate(new RTCIceCandidate(data.payload));
              break;
          }
        }
      });
  }
}

function handleRTCMessage(e) {
  let data = JSON.parse(e.data);
  
  switch (data.code) {
    case NAME_OK:
      name = data.payload;
      document.getElementById('name').innerHTML = name;
      break;
    case NAME_FAIL_DUP:
      message(data.payload, BOT, bot=true);
      break;
    case CHAT:
      message(data.payload, data.from);
      break;
    case BOT_BROADCAST:
      message(data.payload, BOT, bot=true);
      break;
    case GAME_STATE:
      let oldState = gameState;
      gameState = data;

      if (gameState.names.length != oldState.names.length) {
        updateNames();
      }

      break;
  }
}

function handleRTCMessageHost(e) {
  let data = JSON.parse(e.data);

  switch (data.code) {
    case NAME:
      if (data.payload in host.conns) {
        this.send(JSON.stringify({
          payload: `${data.payload} already exists. Try another name.`,
          code: NAME_FAIL_DUP
        }));
      } else {
        /* Numeric peerId is temporary, only used for signaling.
           After signaling is done, identify peers by their names. */
        let conn = host.conns[this.peerId];
        delete host.conns[this.peerId];

        this.peerId = data.payload;
        host.conns[this.peerId] = conn;

        this.send(JSON.stringify({
          payload: this.peerId,
          code: NAME_OK
        }));

        message(`Welcome, <span class="mention">${this.peerId}</span>.`, BOT, bot=true);

        host.broadcast({
          payload: `Welcome, <span class="mention">${this.peerId}</span>.`,
          code: BOT_BROADCAST
        });

        gameState.names.push(this.peerId);
        updateNames();
        host.broadcast(gameState);
      }
      break;
    case CHAT:
      message(data.payload, data.from);
      host.broadcast(data, data.from);
      break;
    case HANDSHAKE:
      this.send(JSON.stringify(gameState));
      break;
  }
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
      } else if (nodeState != NEW && nodeState != JOINING) {
        if (!name) {
          message(NO_NAME, BOT, bot=true);
        } else {
          message(textBox.value, name);

          if (host) {
            host.broadcast({payload: textBox.value, from: name, code: CHAT});
          } else {
            conn.dataChannel.send(JSON.stringify({payload: textBox.value, from: name, code: CHAT}));
          }
        }
      } else {
        message(textBox.value, '...');
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

  chatHistory.prepend(container);
}

function updateNames() {
  names.innerHTML = gameState.names.join('\n');
}

function handleCommand(text) {
  let args = text.split(' ');
  let c = args.shift();
  if (c in commands) {
    commands[c](...args);
  } else {
    message(COMMAND_NOT_RECOGNIZED, BOT, bot=true);
  }
}

message(INTRO, BOT, bot=true);







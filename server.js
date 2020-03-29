const { createServer } = require('http');
const Router = require('./router');
const ecstatic = require('ecstatic');

const router = new Router();

const defaultHeaders = {'Content-Type': 'text/plain'};

// request is a readable stream
function readStream(stream) {
    return new Promise((resolve, reject) => {
        let data = '';
        stream.on('error', reject);
        stream.on('data', chunk => data += chunk.toString());
        stream.on('end', () => resolve(data));
    });
}

// add room
router.add('POST', /^\/rooms\/([^\/]+)$/, async (server, roomId, request) => {
    if (roomId in server.rooms) {
        return {status: 409, body: `${roomId} already exists. Try another name!`};
    } else {
        let queues = {};
        queues[0] = [];
        server.rooms[roomId] = {nextId: 1, queues: queues};
        server.waiting[roomId] = [];
        return {status: 201};
    }
});

// join room
router.add('PUT', /^\/rooms\/([^\/]+)$/, async (server, roomId, searchParams, request) => {
    if (!roomId in server.rooms) {
        return {status: 409, body: `${roomId} doesn't exist.`};
    } else {
        if (!searchParams.get('dest')) {
            let id = server.rooms[roomId].nextId++;
            server.rooms[roomId].queues[id] = [];
            return {status: 201, body: JSON.stringify({peerId: id})};
        }

        let data = await readStream(request);
        // console.log(data);        
        server.rooms[roomId].queues[searchParams.get('dest')].push(data);
        server.updated(roomId, searchParams.get('dest')); // awake waiting requests

        return {status: 201};
    }
});

// get signal info
router.add('GET', /^\/rooms\/([^\/]+)$/, async (server, roomId, searchParams, request) => {
    // let tag = /"(.*)"/.exec(request.headers['if-none-match']);
    let wait = /wait=(\d+)/.exec(request.headers['prefer']);

    return server.waitForChanges(wait[1], roomId, searchParams.get('dest'));
});

class Server {
    constructor() {
        this.rooms = {};
        this.waiting = {};

        let fileServer = ecstatic({root: './public'});
        this.server = createServer((req, res) => {
            let resolved = router.resolve(this, req);
            // handlers return promises that resolve to objects
            // describing the response
            if (resolved) {
                resolved.catch(err => {
                    if (err.status != null) return err;
                    return {body: String(err), status: 500};
                }).then(({body, status = 200, headers = defaultHeaders}) => {
                    res.writeHead(status, headers);
                    res.end(body);
                });
            } else {
                fileServer(req, res);
            }
        });
    }

    start(port) {
        // blocks?
        console.log(`listening on port ${port}...`);
        this.server.listen(port);
    }

    stop() {
        this.server.close();
    }

    waitForChanges(time, roomId, dest) {
        return new Promise(resolve => {
            resolve.dest = dest;
            if (this.rooms[roomId].queues[dest].length == 0) {
                this.waiting[roomId].push(resolve);
                setTimeout(() => {
                    if (!this.waiting[roomId].includes(resolve)) {
                        return;
                    }
                    this.waiting[roomId] = this.waiting[roomId].filter(r => r != resolve);
                    resolve({status: 201, body: JSON.stringify(this.rooms[roomId].queues[dest])});
                    this.rooms[roomId].queues[dest] = [];
                }, time * 1000);
            } else {
                resolve({status: 201, body: JSON.stringify(this.rooms[roomId].queues[dest])});
                this.rooms[roomId].queues[dest] = [];
            }
        })
    }

    updated(roomId, dest) {
        let response = {
            body: JSON.stringify(this.rooms[roomId].queues[dest])
        };

        this.waiting[roomId].forEach(resolve => {
            if (resolve.dest == dest) {
                resolve(response);
                this.rooms[roomId].queues[dest] = [];
            }
        });

        this.waiting[roomId] = this.waiting[roomId].filter(resolve => resolve.dest != dest);
    }
}

let server = new Server();
server.start(5000);
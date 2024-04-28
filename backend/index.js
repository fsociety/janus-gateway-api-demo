const express = require('express');
const app = express();
var cors = require('cors')
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const JanusOperations = require("./janus-operations");

app.use(cors());


app.get('/', (req, res) => {
  res.status(200).send("Hello World!")
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on("initJanus",async (options, callback) => {
    const sid = await JanusOperations.sendCreate();
    callback(sid);
    const handleId = await JanusOperations.sendAttach(sid, false);
    await JanusOperations.createRoom(sid, options.room, handleId);
    await JanusOperations.sendJoin(sid, handleId, false, options.room);
    await JanusOperations.sendOffer(sid, handleId, options.offerSdp);
  })

  socket.on("subscribeJanus",async (options) => {
    const { id, private_id, session_id, room } = options;
    const handleId = await JanusOperations.sendAttach(session_id, true); // subscriber handle id
    await JanusOperations.sendJoin(session_id, handleId, true, room, id);
  })

  socket.on("startJanus",async (options) => {
    const { session_id, handleId, room, jsep } = options;
    await JanusOperations.configureStart(session_id, handleId, room, jsep);
  })
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
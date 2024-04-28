import "./app.scss";
import axios from "axios";
import { v4 } from "uuid";

const ICEServers = {
    iceServers: [
        {
            urls: [
                "stun:stun.l.google.com:19302", 
                "stun:stun1.l.google.com:19302", 
                "stun:stun2.l.google.com:19302", 
                "stun:stun3.l.google.com:19302",
                "stun:stun4.l.google.com:19302"
            ]
        }
    ],
    iceCandidatePoolSize: 10
}

let pc = null;
let localStream = null;
let remoteStream = null;

let subscriber_pc = null;

//elements
const startWebcam = document.getElementById("start-webcam");
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const initJanusBtn = document.getElementById("init-janus");
const hangupBtn = document.getElementById("hangup");

document.addEventListener("DOMContentLoaded", init);
startWebcam.addEventListener("click", startCamera);
initJanusBtn.addEventListener("click", initJanus);
hangupBtn.addEventListener("click", hangup);

const janusUrl = "http://localhost:8088/janus";
let session_id, feeds = {}, room = 2244;

function init(){
    pc = new RTCPeerConnection(ICEServers);

    pc.ontrack = (event) => {
        console.log("pc ontrack!", pc.getSenders());
        event.streams[0].getTracks().forEach(track => {
            console.log("pc-ontrack",track)
        })
    }

    pc.onconnectionstatechange = (event) => {
        console.log("connection state changed: " + pc.connectionState);
        if(["disconnected", "closed"].includes(pc.connectionState)){
            //closed
        }
    }

}

function initSubscirberPC(){
    if(subscriber_pc) return;
    subscriber_pc = new RTCPeerConnection(ICEServers);

    subscriber_pc.ontrack = (event) => {
        console.log("subscriber_pc ontrack!", subscriber_pc.getSenders());
        event.streams[0].getTracks().forEach(track => {
            console.log("subscriber_pc-ontrack",track)
            remoteStream.addTrack(track);
        })
    }

    subscriber_pc.onconnectionstatechange = (event) => {
        console.log("connection state changed: " + subscriber_pc.connectionState);
        if(["disconnected", "closed"].includes(subscriber_pc.connectionState)){
            remoteStream = null;
            remoteVideo.srcObject = null;
        }
    }
}

async function startCamera(){
    if(!pc) init();
    localStream = await navigator.mediaDevices.getUserMedia({video:true, audio: true});
    remoteStream = new MediaStream();

    localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
        console.log("pc1 - local tracks added!", pc.getSenders());
    });

    remoteVideo.srcObject = remoteStream;
    localVideo.srcObject = localStream;
}

async function createOffer(){
    pc.onicecandidate = (event) => {
        if(event.candidate){
            //offer
            //pc.localDescription
        }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
}

async function initJanus(){
    function sendCreate() {
        return new Promise(async (resolve,reject) => {
            try{
                console.log("control::sendCreate ------------");
                var transaction = v4();
                var request = {"janus": "create", "transaction": transaction};
                const {data: response} = await axios.post(janusUrl, request)
                console.log("control::sendCreate response: ", response)
                session_id = response.data['id'];
                // Start gatehering events for this session
                getEvent();
                var janus_result = response.janus;
            
                if (janus_result === "success") {
                    console.log("Create successful... now attach to plugin...");
                    resolve(session_id);
                }
            } catch(err){
                reject(err);
            }
        })
    }


    async function getEvent() {
        const path = '/' + session_id;
        const request_url = janusUrl + path;
        setTimeout(getEvent, 2000);
        const {data: response} = await axios.get(request_url, {
            params: {
                maxev: 1
            }
        });
        console.log("control::getEvent response: ", response);
        if(response.janus === "event" && response.jsep && response.jsep.type === "answer") {
            addAnswer(response.jsep);
        }

        if(response.janus === "event" && response.jsep && response.jsep.type === "offer") {
            (async () => {
                const answerSdp = await createAnswer(response.jsep);
                let feed = Object.values(feeds).find((f) => f.subscriber_handle_id === response.sender)
                configureStart(feed.subscriber_handle_id, answerSdp);
            })()
        }
        
        if("plugindata" in response && "data" in response.plugindata) {
            if((response.plugindata.data['videoroom'] == "joined") || (response.plugindata.data['videoroom'] == "event")){
                let private_id = response.plugindata.data.private_id;
                const publishers = response.plugindata.data.publishers;
                if(publishers) console.log("publisher----------", publishers);
                for(var f in publishers) {
                    var id = publishers[f]["id"];
                    var display = publishers[f]["display"];
                    var audio = publishers[f]["audio_codec"];
                    var video = publishers[f]["video_codec"];
                    console.log("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                    if(!feeds[id]){
                        feeds[id] = {"display": display, "audio": audio, "video": video};
                        initSubscriber(id);
                    }
                }
            }
        }
    }

    async function initSubscriber(id) {
        initSubscirberPC();
        const handle = await sendAttach(true, id); // subscriber handle id
        await sendJoin(handle, true, room, id);
    }

    function sendAttach(is_subscriber, feed) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log("control::sendAttach -----");
                let transaction = v4();
                const path = '/' + session_id;
                const request_url = janusUrl + path;
                let request = {
                    "janus": "attach",
                    "plugin": "janus.plugin.videoroom",
                    "opaque_id": transaction + "1",
                    "transaction": transaction
                };
                const {data:response} = await axios.post(request_url, request);
                
                console.log("control::sendAttach response: ", response);
                const handle_id = response.data.id;
                console.log("handleId",handle_id);
                if (is_subscriber) {
                    feeds[feed].subscriber_handle_id = handle_id;
                    console.log("Handle ID (Subscriber): " + handleId + " feed: " + feed);
                } else {
                    console.log("Handle ID (Publisher): ", handle_id);
                }
                resolve(handle_id);
                
            } catch(err) {
                reject(err);
            }
        });
    }

    function createRoom(room, handleId) {
        return new Promise(async (resolve, reject) => {
            try {
                let transaction = v4();
                var path = '/' + session_id + "/" + handleId;
                const request_url = janusUrl + path;
                console.info("control::createRoom - " + room);
                let request = {
                    "janus": "message",
                    "transaction": transaction,
                    "opaque_id": "1" + transaction,
                    "body": {"request": "create", "room": room, "description": "exampleroom", "is_private": false}
                }
                const {data: response} = await axios.post(request_url, request)
                console.log("control::createRoom response", response);
                resolve(response);
            } catch(err) {
                reject(err)
            }
        })  
    }

    function sendJoin(handleId, is_subscriber, room, feed) {
        return new Promise(async (resolve, reject) => {
            try {
                let transaction = v4();
                var path = '/' + session_id + '/' + handleId;
                const request_url = janusUrl + path;
                let request = {
                    "janus": "message",
                    "transaction": transaction,
                    "opaque_id": "1" + transaction,
                    "body": {"request": "join", "room": room, "ptype": "publisher", "display": "gv"}
                }
                if (is_subscriber) {
                    console.log("control::sendJoin - subscriber handle ID: " + handleId + " - feed: " + feed);
                    request = {
                        "janus": "message",
                        "transaction": transaction,
                        "opaque_id": "1" + transaction,
                        "body": {
                            "request": "join",
                            "room": room,
                            "ptype": "subscriber",
                            //"offer_video": true,
				            //"offer_audio": true,
                            "feed": feed,
                            "display": "gv"
                        }
                    }
                }
                const {data: response} = await axios.post(request_url, request)
            
                var janus_result = response.janus;
                if (janus_result === "ack" && !is_subscriber) {
                    console.log("JOIN for subscriber acked... now send offer...", response);
                }
                resolve(response);
            } catch(err) {
                reject(err)
            }
        })  
    }

    function sendOffer(handleId) {
        return new Promise(async (resolve, reject) => {
            try {
                let transaction = v4();
                var path = '/' + session_id + '/' + handleId;
                const request_url = janusUrl + path;
                var request = {
                    "janus": "message",
                    "body": {"request": "configure", "audio": true, "video": true},
                    "transaction": transaction,
                    "jsep": {"type": "offer", "sdp": pc.localDescription.sdp, "trickle": false}
                };
                const {data: response} = await axios.post(request_url, request)
            
                var janus_result = response.janus;
                if (janus_result === "ack") {
                    console.log("offer acked... now wait for answer from events...");
                    resolve();
                }
            } catch(err) {
                reject(err)
            }
        })  
    }

    function configureStart(handleId, jsep){
        return new Promise(async (resolve, reject) => {
            try {
                let transaction = v4();
                var path = '/' + session_id + '/' + handleId;
                const request_url = janusUrl + path;
                var request = {
                    "janus": "message",
                    "body": {"request": "start", "room": room},
                    "transaction": transaction,
                    "jsep": {"type": "answer", "sdp": jsep.sdp, "trickle": false} //answer sdp
                };
                console.log("start request, ", request_url, request);
                const {data: response} = await axios.post(request_url, request)
            
                console.log("configureStart...");
                resolve(response);
            } catch(err) {
                reject(err)
            }
        })  
    }

    await createOffer();
    const sid = await sendCreate();
    const handleId = await sendAttach(false);
    await createRoom(room, handleId);
    await sendJoin(handleId, false, room);
    await sendOffer(handleId);
}

function createAnswer(jsep){
    return new Promise(async (resolve, reject) => {
        const offer = jsep;
        subscriber_pc.onicecandidate = (event) => {
            if(event.candidate){
                //answer sdp
                resolve(subscriber_pc.localDescription);
            }
        }
        await subscriber_pc.setRemoteDescription(offer);
        const answer = await subscriber_pc.createAnswer();
        subscriber_pc.setLocalDescription(answer);
    });
}

async function addAnswer(jsep){
    const answer = jsep;
    if(!pc.currentRemoteDescription){
        pc.setRemoteDescription(answer);
    }
}

function hangup(){
    pc.close();
    localStream.getTracks().forEach(track => {
        track.stop();
    });
    localVideo.srcObject = null;
    pc = null;
    localStream = null;
    remoteStream = null;
}

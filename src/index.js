import "./app.scss";
import { io } from "socket.io-client";
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

let socket = io("http://localhost:3000", { transports : ['websocket'] });

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
let feeds = {}, room = 2244;

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

function createOffer(){
    return new Promise(async (resolve, reject) => {
        try {
            pc.onicecandidate = (event) => {
                if(event.candidate){
                    resolve(pc.localDescription)
                }
            }
        
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
        } catch(err) {
            reject(err);
        }
    })
}

async function initJanus(){
    const offerSdp = await createOffer();
    let options = {
        room,
        offerSdp: offerSdp
    }
    socket.emit("initJanus", options, (sid) => {
        console.log("Janus initialization signal sent. sessionId: " + sid);
        getEvent(sid);
    })

    async function getEvent(session_id) {
        const path = '/' + session_id;
        const request_url = janusUrl + path;
        setTimeout(() => getEvent(session_id), 2000);
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
                socket.emit("startJanus", {session_id, handleId: response.sender, room, jsep: answerSdp})
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
                        initSubscriber(id, private_id, session_id);
                    }
                }
            }
        }
    }

    async function initSubscriber(id, private_id, session_id) {
        initSubscirberPC();
        socket.emit("subscribeJanus", {id, private_id, session_id, room})
    }
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

const axios = require("axios");
const { v4 } = require("uuid");

let janusUrl = "http://localhost:8088/janus"

class JanusOperations {
    static sendCreate() {
        return new Promise(async (resolve,reject) => {
            try{
                console.log("control::sendCreate ------------");
                var transaction = v4();
                var request = {"janus": "create", "transaction": transaction};
                const {data: response} = await axios.post(janusUrl, request)
                console.log("control::sendCreate response: ", response)
                const session_id = response.data['id'];
                // Start gatehering events for this session
                //getEvent();
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

    static sendAttach(session_id, is_subscriber){
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
                    //feeds[feed].subscriber_handle_id = handle_id;
                    //console.log("Handle ID (Subscriber): " + handle_id + " feed: " + feed);
                    console.log("Handle ID (Subscriber): ", handle_id);
                } else {
                    console.log("Handle ID (Publisher): ", handle_id);
                }
                resolve(handle_id);
                
            } catch(err) {
                reject(err);
            }
        });
    }

    static createRoom(session_id, room, handleId){
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

    static sendJoin(session_id, handleId, is_subscriber, room, feed){
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

    static sendOffer(session_id, handleId, offerSdp){
        return new Promise(async (resolve, reject) => {
            try {
                let transaction = v4();
                var path = '/' + session_id + '/' + handleId;
                const request_url = janusUrl + path;
                var request = {
                    "janus": "message",
                    "body": {"request": "configure", "audio": true, "video": true},
                    "transaction": transaction,
                    "jsep": {"type": "offer", "sdp": offerSdp.sdp, "trickle": false}
                };
                console.log(request_url, request);
                const {data: response} = await axios.post(request_url, request)
            
                var janus_result = response.janus;
                if (janus_result === "ack") {
                    console.log("offer acked... now wait for answer from events...");
                }
                resolve(response);
            } catch(err) {
                reject(err)
            }
        })
    }

    static configureStart(session_id, handleId, room, jsep){
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
}

module.exports = JanusOperations;
// ```
// WEB API NOTES

// EVENT HANDLER DESC:
//     https://developer.mozilla.org/en-US/docs/Web/API/Event


// ```






// AGORA AUTH
let appID = "87a1ad423e85463a8d826977f80c61a3"
let token = null;

//FUNCTIONALITY INIT
let uid = String(Math.floor(Math.random() * 10000000)); //save into database later
let client;
let channel;

// VIDEO MEDIA OBJECTS FROM HTML/CAMERA
let localStream; //yours
let remoteStream; //theirs

//RTC CONNECTION
let peerConnection;

// STUN SERVER LIST
const servers = {
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
}


//GET URL ARGUEMTNS AND VALUES
let queryString = window.location.search
let urlParams = new URLSearchParams(queryString)
let room_id = urlParams.get('room')
if (!room_id) {
    window.location = 'lobby.html'
}




//VIDEO AND MICROPHONE SETTINGS!
let constraints = {
    video: {
        width: { min: 640, ideal: 1920, max: 1920 },
        height: { min: 480, ideal: 1080, max: 1080 },
    },
    audio: true
}




//ON START
let init = async () => {

    // AGORA FUNCTIONALITY
    client = await AgoraRTM.createInstance(appID); // USERS WEBPAGE
    await client.login({ uid, token })
    channel = client.createChannel(room_id)  // AGORA CHAT ROOM
    await channel.join()


    // event listeners
    channel.on("MemberJoined", handleUserJoin)
    channel.on("MemberLeft", handleMemberLeft)
    client.on("MessageFromPeer", handleMessageFromPeer)


    //REQUEST ACCESS TO CLIENT CAMERA/MIC
    localStream = await navigator.mediaDevices.getUserMedia(constraints)
    document.getElementById('user-1').srcObject = localStream
}



// EVENT HANDLERS
let handleUserJoin = async (memberID) => {
    console.log("\n\n\n", memberID, " joined\n\n\n");
    createOffer(memberID);
}
let handleMemberLeft = async (memberID) => {
    //REMOVE ATTRIBUTES FROM DIVS
    document.getElementById('user-2').style.display = 'none'
    document.getElementById('user-1').classList.remove('smallFrame')
    console.log("\n\n\n", memberID, " left\n\n\n");
}



let handleMessageFromPeer = async (message, memberID) => {
    message = JSON.parse(message.text)
    if (message.type == 'offer') {
        createAnswer(memberID, message.offer)
    }

    if (message.type == 'answer') {
        addAnswer(message.answer)
    }

    if (message.type == 'candidate') {
        if (peerConnection) {
            peerConnection.addIceCandidate(message.candidate)
        }
    }

}






let createPeerConnection = async (memberID) => {
    //INIT STREAMING OBJECTS TO VIEW PARTY MEMEBER
    peerConnection = new RTCPeerConnection(servers)
    remoteStream = new MediaStream()

    // ADD ATTRIBUTES TO DIV ELEMENTS
    document.getElementById('user-2').srcObject = remoteStream
    document.getElementById('user-2').style.display = 'block'

    document.getElementById('user-1').classList.add('smallFrame')


    //REQUEST ACCESS TO CLIENT CAMERA/MIC IF NULL (refresh too fast glitch)
    if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        document.getElementById('user-1').srcObject = localStream
    }


    //Add tracks of CLIENT stream to the offer
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream)
    });

    // Listen for PARTY MEMBER adds track
    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track)
        })
    }

    // CREATE ICE cannidate  (request candidates from STUN server)
    peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            // sending message to party peer when there is a connection made
            client.sendMessageToPeer(
                {
                    text: JSON.stringify(
                        {
                            'type': 'candidate',
                            'candidate': event.candidate
                        }
                    )
                },
                memberID
            )
        }
    }

}




//peer connection logic after user joins
let createOffer = async (memberID) => {

    //CREATE PEER TO PEER CONNECTION
    await createPeerConnection(memberID)


    // CREATE ICE offer
    let offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)

    // sending connection offer to party peer
    client.sendMessageToPeer(
        {
            text: JSON.stringify(
                {
                    'type': 'offer',
                    'offer': offer
                }
            )
        },
        memberID
    )
}







let createAnswer = async (memberID, offer) => {
    //CREATE PEER TO PEER CONNECTION
    await createPeerConnection(memberID)

    await peerConnection.setRemoteDescription(offer)

    let answer = await peerConnection.createAnswer()

    await peerConnection.setLocalDescription(answer)

    // sending connection accept answer to party peer
    client.sendMessageToPeer(
        {
            text: JSON.stringify(
                {
                    'type': 'answer',
                    'answer': answer
                }
            )
        },
        memberID
    )

}

let addAnswer = async (answer) => {
    if (!peerConnection.currentRemoteDescription) {
        peerConnection.setRemoteDescription(answer)
    }
}



let leaveChannel = async (answer) => {
    await channel.leave()
    await channel.logout()
}





let toggleCamera = async () => {
    let videoTrack = localStream.getTracks().find(track => track.kind === 'video')

    if (videoTrack.enabled) {
        videoTrack.enabled = false;
        document.getElementById('camera-btn').style.backgroundColor = 'rgb(255,80,80)'
    }
    else {
        videoTrack.enabled = true;
        document.getElementById('camera-btn').style.backgroundColor = 'rgb(179,102,249, .9)'

    }
}


let toggleMic = async () => {
    let AudioTrack = localStream.getTracks().find(track => track.kind === 'audio')

    if (AudioTrack.enabled) {
        AudioTrack.enabled = false;
        document.getElementById('mic-btn').style.backgroundColor = 'rgb(255,80,80)'
    }
    else {
        AudioTrack.enabled = true;
        document.getElementById('mic-btn').style.backgroundColor = 'rgb(179,102,249, .9)'

    }
}










// ON EXIT EVENT HANDLERS
window.addEventListener('beforeunload', leaveChannel)

//CAMERA / MICROPHONE CONTROLS FUNCTION CLICK EVENTS
document.getElementById('camera-btn').addEventListener('click', toggleCamera)
document.getElementById('mic-btn').addEventListener('click', toggleMic)



init()
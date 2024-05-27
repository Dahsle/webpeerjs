import { createDelegatedRoutingV1HttpApiClient } from '@helia/delegated-routing-v1-http-api-client'
import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { createLibp2p } from 'libp2p'
import { IDBBlockstore } from 'blockstore-idb'
import { IDBDatastore } from 'datastore-idb'
import { Key } from 'interface-datastore'
import { webTransport } from '@libp2p/webtransport'
import { webSockets } from '@libp2p/websockets'
import * as config from  './config'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify, identifyPush } from '@libp2p/identify'
import { multiaddr } from '@multiformats/multiaddr'
import first from 'it-first'
import { peerIdFromString } from '@libp2p/peer-id'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { mkErr,PBPeer } from './utils'
import { sha256 } from 'multiformats/hashes/sha2'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

class webpeerjs{
	
	#libp2p
	#helia
	#discoveredPeers
	#webPeersId
	#dbstore
	#dialedGoodPeers
	#isDialWebtransportOnly
	#dialedKnownBootstrap
	#dialedDiscoveredPeers
	#rooms
	#connectedPeers
	#connectedPeersArr
	
	id
	status
	IPFS
	address
	peers
	
	constructor(helia,dbstore){
		
		this.#libp2p = helia.libp2p
		this.#helia = helia
		this.#dbstore = dbstore
		this.#discoveredPeers = new Map()
		this.#webPeersId = []
		this.#dialedGoodPeers = []
		this.#isDialWebtransportOnly = true
		this.#dialedKnownBootstrap = new Map()
		this.#dialedDiscoveredPeers = []
		this.address = []
		this.#rooms = {}
		this.#connectedPeers = new Map()
		this.#connectedPeersArr = []
		
		this.peers = (function(f) {
			return f
		})(this.#connectedPeersArr);
		
		this.status = (function(libp2p) {
			return libp2p.status
		})(this.#libp2p);

		this.IPFS = (function(helia,libp2p,discoveredPeers) {
			const obj = {helia,libp2p,discoveredPeers}
			return obj
		})(this.#helia,this.#libp2p,this.#discoveredPeers);
		
		this.id = this.#libp2p.peerId.toString()
		
		
		//Listen to peer connect event
		this.#libp2p.addEventListener("peer:connect", (evt) => {
			const connection = evt.detail;
			//console.log(evt)
			//console.log(`Connected to ${connection.toString()}`);
			
			//announce via joinRoom version 1
			if(connection.toString() === config.CONFIG_KNOWN_BOOTSTRAP_PEER_IDS[0] || this.#webPeersId.includes(connection.toString())){
				setTimeout(()=>{
					this.#announce()
				},1000)
			}
			
		});


		//Subscribe to pupsub topic
		this.#libp2p.services.pubsub.addEventListener('message', event => {
			//console.log('on:'+event.detail.topic,event.detail.data)
			if (event.detail.type !== 'signed') {
			  return
			}
			if(config.CONFIG_JOIN_ROOM_VERSION == 1){
				const topic = event.detail.topic
				const senderPeerId = event.detail.from.toString()
				if(config.CONFIG_PUBSUB_PEER_DISCOVERY.includes(topic)){
					try{
						const peer = PBPeer.decode(event.detail.data)
						const msg = uint8ArrayToString(peer.addrs[0])
						//console.log(msg)
						const json = JSON.parse(msg)
						const prefix =json.prefix
						const room = json.room
						const message = json.message
						const signal = json.signal
						const id = json.id
						if(id != senderPeerId)return
						const address = json.address
						if(prefix === config.CONFIG_PREFIX){
							if(room)this.#rooms[room].onMessage(message,id)
							if(signal){
								if(signal == 'announce'){
									setTimeout(()=>{this.#answer()},1000)
									if(!this.#connectedPeers.has(id))this.#onConnectFn(id)
									if(!this.#webPeersId.includes(id))this.#webPeersId.push(id)
									this.#connectedPeers.set(id,address)
									this.#connectedPeersArr.length = 0
									for(const peer of this.#connectedPeers){
										const item = {id:peer[0],address:peer[1]}
										this.#connectedPeersArr.push(item)
									}
									
								}
								if(signal == 'answer'){
									if(!this.#connectedPeers.has(id))this.#onConnectFn(id)
									if(!this.#webPeersId.includes(id))this.#webPeersId.push(id)
									this.#connectedPeers.set(id,address)
									this.#connectedPeersArr.length = 0
									for(const peer of this.#connectedPeers){	
										const item = {id:peer[0],address:peer[1]}
										this.#connectedPeersArr.push(item)
									}
									
								}
							}
						}

					}catch(err){}
				}else{
					const json = JSON.parse(topic)
					const room = json.room
					const message = new TextDecoder().decode(event.detail.data)
					this.#rooms[room].onMessage(message)
				}
			}
			
			if(config.CONFIG_JOIN_ROOM_VERSION == 2){
				const topic = event.detail.topic
				if(config.CONFIG_PUBSUB_PEER_DISCOVERY.includes(topic)){
					try{
						const peer = PBPeer.decode(event.detail.data)						
						const msg = uint8ArrayToString(peer.addrs[0])
						const json = JSON.parse(msg)
						const prefix =json.prefix
						const room = json.room
						const message = json.message
						if(prefix === config.CONFIG_PREFIX){
							this.#rooms[room].onMessage(message)
						}
					}catch(err){}
				}else{
					const json = JSON.parse(topic)
					const room = json.room
					const message = new TextDecoder().decode(event.detail.data)
					this.#rooms[room].onMessage(message)
				}
			}
			
		})
		
		
		//Listen to peer discovery event
		this.#libp2p.addEventListener('peer:discovery', (evt) => {

			//console.log('Discovered:', evt.detail.id.toString())
			//console.log('Discovered:', evt.detail.multiaddrs.toString())
			this.#discoveredPeers.set(evt.detail.id.toString(), evt.detail)
			if(evt.detail.multiaddrs.toString() != ''){
				const multiaddrs = evt.detail.multiaddrs
				if(multiaddrs.toString().includes('p2p-circuit')){
					let mddrs = []
				
					for(const addr of multiaddrs){
						let peeraddr
						if(addr.toString().includes('/p2p/')){
							peeraddr = addr.toString()
						}else{
							peeraddr = addr.toString()+'/p2p/'+evt.detail.id.toString()
						}
						const peermddr = multiaddr(peeraddr)
						mddrs.push(peermddr)
					}
					
					this.#dialWebtransport(mddrs)
					if(!this.#isDialWebtransportOnly){
						this.#dialWebsocket(mddrs)
					}
				}
			}
		})

		
		//Listen to peer disconnect event
		this.#libp2p.addEventListener("peer:disconnect", (evt) => {
			const connection = evt.detail;
			//console.log(`Disconnected from ${connection.toCID().toString()}`);
			const id = evt.detail.string
			if(this.#connectedPeers.has(id))
			{
									const address = this.#connectedPeers.get(id)
									this.#connectedPeers.delete(id)
									this.#connectedPeersArr.length = 0
									for(const peer of this.#connectedPeers){	
										const item = {id:peer[0],address:peer[1]}
										this.#connectedPeersArr.push(item)
									}
									let mddrs = []
									for (const addr of address){
										const m = multiaddr(addr)
										mddrs.push(m)
									}
									this.#dialWebtransport(mddrs)
									if(!this.#isDialWebtransportOnly){
										this.#dialWebsocket(mddrs)
									}
									this.#onDisconnectFn(id)
			}
		});
		
		
		//Listen to self peer update
		this.#libp2p.addEventListener('self:peer:update', ({ detail: { peer } }) => {
			const multiaddrs = peer.addresses.map(({ multiaddr }) => multiaddr)
			//console.log(`changed multiaddrs: peer ${peer.id.toString()} multiaddrs: ${multiaddrs}`)
			const id = peer.id.toString()
			const addresses = []
			peer.addresses.forEach((addr)=>{
				const maddr = addr.multiaddr.toString()+'/p2p/'+id
				if(maddr.includes('webtransport') && maddr.includes('certhash')){
					addresses.push(maddr)
				}
			})
			this.#ListenAddressChange(addresses)
			this.address = addresses
			this.#answer()
		})
		  
		this.#dialKnownPeers()
		  
		this.#watchConnection()
		
		this.#connectionTracker()
		
		this.#dialRandomBootstrap()
		
		//this.#dialdiscoveredpeers()

	}
	
	
	
	
	//Listen on new peer connection
	#onConnectFn = () => {}
	onConnect = f => (this.#onConnectFn = f)


	//Listen on peer disconnect
	#onDisconnectFn = () => {}
	onDisconnect = f => (this.#onDisconnectFn = f)
	

	//announce and answer via joinRoom version 1
	async #announce(){
			const topic = config.CONFIG_PEER_DISCOVERY_UNIVERSAL_CONNECTIVITY
			const data = JSON.stringify({prefix:config.CONFIG_PREFIX,signal:'announce',id:this.#libp2p.peerId.toString(),address:this.address})
			const peer = {
			  publicKey: this.#libp2p.peerId.publicKey,
			  addrs: [uint8ArrayFromString(data)],
			}
			const encodedPeer = PBPeer.encode(peer)
			await this.#libp2p.services.pubsub.publish(topic, encodedPeer)
	}
	async #answer(){
			const topic = config.CONFIG_PEER_DISCOVERY_UNIVERSAL_CONNECTIVITY
			const data = JSON.stringify({prefix:config.CONFIG_PREFIX,signal:'answer',id:this.#libp2p.peerId.toString(),address:this.address})
			const peer = {
			  publicKey: this.#libp2p.peerId.publicKey,
			  addrs: [uint8ArrayFromString(data)],
			}
			const encodedPeer = PBPeer.encode(peer)
			await this.#libp2p.services.pubsub.publish(topic, encodedPeer)
	}

	
	joinRoom = room => {
		if (this.#rooms[room]) {
			return [
				this.#rooms[room].sendMessage,
				this.#rooms[room].listenMessage
			]
			
			if (!room) {
				throw mkErr('room is required')
			}
		}
		
		//Join room version 1 user pupsub via libp2p universal connectivity
		if(config.CONFIG_JOIN_ROOM_VERSION == 1){

			const topic = config.CONFIG_PEER_DISCOVERY_UNIVERSAL_CONNECTIVITY
			//this.#libp2p.services.pubsub.subscribe(topic)
			
			this.#rooms[room] = {
				onMessage : () => {},
				listenMessage : f => (this.#rooms[room] = {...this.#rooms[room], onMessage: f}),
				sendMessage : async (message) => {
					const data = JSON.stringify({prefix:config.CONFIG_PREFIX,room,message,id:this.#libp2p.peerId.toString()})
					const peer = {
					  publicKey: this.#libp2p.peerId.publicKey,
					  addrs: [uint8ArrayFromString(data)],
					}
					const encodedPeer = PBPeer.encode(peer)
					await this.#libp2p.services.pubsub.publish(topic, encodedPeer)
				}
			}
		}

		//not implemented yet
		if(config.CONFIG_JOIN_ROOM_VERSION == 2){

			const topic = JSON.stringify({id:config.CONFIG_PREFIX,room})
			this.#libp2p.services.pubsub.subscribe(topic)
			
			this.#rooms[room] = {
				onMessage : () => {},
				listenMessage : f => (this.#rooms[room] = {...this.#rooms[room], onMessage: f}),
				sendMessage : async (message) => {
					await this.#libp2p.services.pubsub.publish(topic, new TextEncoder().encode(message))
				}
			}
		}
		
		return [
			this.#rooms[room].sendMessage,
			this.#rooms[room].listenMessage
		]
	}
	
	
	//Dial discovered peers
	#dialdiscoveredpeers(){
		setInterval(()=>{
			const keys = Array.from(this.#discoveredPeers.keys())
			for(const key of keys){
				if(!this.#dialedDiscoveredPeers.includes(key)){
					this.#dialedDiscoveredPeers.push(key)
					const peer = this.#discoveredPeers.get(key)
					const mddrs = peer.multiaddrs
					this.#dialWebtransport(mddrs)
					if(!this.#isDialWebtransportOnly){
						this.#dialWebsocket(mddrs)
					}
					break
				}
			}
		},10*1000)
	}
	
	
	//Dial random known bootstrap periodically
	#dialRandomBootstrap(){
		setInterval(()=>{
			const keys = Array.from(this.#dialedKnownBootstrap.keys())
			const randomKey = Math.floor(Math.random() * keys.length)
			let id = keys[randomKey]
			//currently need universal connectivity id for webpeer discovery and joinRoom version 1 to work
			id = config.CONFIG_KNOWN_BOOTSTRAP_PEER_IDS[0]
			const mddrs = this.#dialedKnownBootstrap.get(id)
			let peers = []
			for(const peer of this.#libp2p.getPeers()){
				peers.push(peer.toString())
			}
			if(!peers.includes(id)){
				this.#dialWebtransport(mddrs)
				if(!this.#isDialWebtransportOnly){
					this.#dialWebsocket(mddrs)
				}
			}
		},10*1000)
	}
	
	
	//Track for good connection
	#connectionTracker(){
		setInterval(async ()=>{
			
			//Save peer address if connection is good
			const connections = this.#libp2p.getConnections()
			for(const connect of connections){
				const peer = connect.remotePeer
				const remote = connect.remoteAddr
				const upgraded = connect.timeline.upgraded
				const limit = 5*60*1000
				const now = new Date().getTime()
				const time = now-upgraded
				if(time>limit){
					const addr = remote.toString()
					const id = peer.toString()
					if(!this.#webPeersId.includes(id) && !config.CONFIG_KNOWN_BOOTSTRAP_PEER_IDS.includes(id)){
						await this.#dbstore.delete(new Key(id))
						await this.#dbstore.put(new Key(id), new TextEncoder().encode(addr))
					}
				}
			}
			
			//Connect to saved good peer address
			let peers = []
			for(const peer of this.#libp2p.getPeers()){
				peers.push(peer.toString())
			}
			let list = []
			for await (const { key, value } of this.#dbstore.query({})) {
				const id = key.toString().split('/')[1]
				const addr = new TextDecoder().decode(value)
				list.push({id,addr})
			}
			list.reverse()
			for(const peer of list){
				if(peers.includes(peer.id) || this.#dialedGoodPeers.includes(peer.id)){
					continue
				}else{
					this.#dialedGoodPeers.push(peer.id)
					let mddrs = []
					const mddr = multiaddr(peer.addr)
					mddrs.push(mddr)
					this.#dialWebtransport(mddrs)
					if(!this.#isDialWebtransportOnly){
						this.#dialWebsocket(mddrs)
					}
					break
				}
			}
			
		},5*1000)
	}

	
	//Update listen address on change
	#ListenAddressChange = () => {}
	#onSelfAddress = f => (this.#ListenAddressChange = f)
	
	
	//Periodically watch for connection
	#watchConnection(){
		setInterval(()=>{
			const peers = this.#libp2p.getPeers().length
			if(peers == 0){
				this.#dialKnownPeers()
			}
		},30000)
	}
	
	
	//Dial to all known bootstrap peers and DNS
	#dialKnownPeers(){
		this.#dialKnownBootstrap()
		setTimeout(()=>{
			const peers = this.#libp2p.getPeers().length
			if(peers == 0){
				this.#dialKnownID()
				setTimeout(()=>{
					const peers = this.#libp2p.getPeers().length
					if(peers == 0){
						this.#dialKnownDNS()
						setTimeout(()=>{
							const peers = this.#libp2p.getPeers().length
							if(peers == 0){
								this.#dialKnowsDNSonly()
							}
						},5000)
					}
				},5000)
			}
		},5000)
	}
	
	
	//Dial based on known bootsrap peers address
	#dialKnownBootstrap(){
		const bootstrap = config.CONFIG_KNOWN_BOOTSTRAP_PEERS_ADDRS
		for(const peer of bootstrap){
			const addrs = peer.Peers[0].Addrs
			const id = peer.Peers[0].ID
			let mddrs = []
			for(const addr of addrs){
				const peeraddr = addr+'/p2p/'+id
				const peermddr = multiaddr(peeraddr)
				mddrs.push(peermddr)
			}
			this.#dialWebtransport(mddrs)
			this.#dialedKnownBootstrap.set(id,mddrs)
		}
	}
	
	
	//Dial based on known peers ID
	async #dialKnownID(){
		const api = config.CONFIG_DELEGATED_API
		const delegatedClient = createDelegatedRoutingV1HttpApiClient('api')
		const BOOTSTRAP_PEER_IDS = config.CONFIG_KNOWN_BOOTSTRAP_PEER_IDS
		const peers = await Promise.all(
			BOOTSTRAP_PEER_IDS.map((peerId) => first(delegatedClient.getPeers(peerIdFromString(peerId)))),
		)
		for(const peer of peers){
			const addrs = peer.Addrs
			const id = peer.ID
			let mddrs = []
			for(const addr of addrs){
				const peeraddr = addr.toString()+'/p2p/'+id.toString()
				const peermddr = multiaddr(peeraddr)
				mddrs.push(peermddr)
			}
			this.#dialWebtransport(mddrs)
			this.#dialedKnownBootstrap.set(id.toString(),mddrs)
		}
	}
	
	
	//Dial based on known bootstrap DNS
	async #dialKnownDNS(){
		const dnsresolver = config.CONFIG_DNS_RESOLVER
		const bootstrapdns = config.CONFIG_KNOWN_BOOTSTRAP_DNS
		const response = await fetch(dnsresolver+'?name='+bootstrapdns+'&type=txt')
		const json = await response.json()
		const dns = json.Answer
		const BOOTSTRAP_PEER_IDS = []
		for(const dnsaddr of dns){
			const id = dnsaddr.data.split('/').pop()
			BOOTSTRAP_PEER_IDS.push(id)
		}
		const api = config.CONFIG_DELEGATED_API
		const delegatedClient = createDelegatedRoutingV1HttpApiClient('api')
		const peers = await Promise.all(
			BOOTSTRAP_PEER_IDS.map((peerId) => first(delegatedClient.getPeers(peerIdFromString(peerId)))),
		)
		for(const peer of peers){
			const addrs = peer.Addrs
			const id = peer.ID
			let mddrs = []
			for(const addr of addrs){
				const peeraddr = addr.toString()+'/p2p/'+id.toString()
				const peermddr = multiaddr(peeraddr)
				mddrs.push(peermddr)
			}
			this.#dialWebtransport(mddrs)
			this.#dialedKnownBootstrap.set(id.toString(),mddrs)
		}
		
	}
	
	
	//Dial based on known bootstrap DNS using DNS resolver only
	async #dialKnowsDNSonly(){
		const dnsresolver = config.CONFIG_DNS_RESOLVER
		const bootstrapdns = config.CONFIG_KNOWN_BOOTSTRAP_DNS
		const response = await fetch(dnsresolver+'?name='+bootstrapdns+'&type=txt')
		const json = await response.json()
		const dns = json.Answer
		
		for(const dnsitem of dns){
			const arr = dnsitem.data.split('/')
			const id = arr.pop()
			const dnsaddr = '_dnsaddr.'+arr[2]
			this.#dialDNSWebsocketWebtransport(id,dnsaddr)
		}
	}
	
	
	//Dial DNS with webtransport and websocket
	async #dialDNSWebsocketWebtransport(id,dnsaddr){
		const dnsresolver = config.CONFIG_DNS_RESOLVER
		const response = await fetch(dnsresolver+'?name='+dnsaddr+'&type=txt')
		const json = await response.json()
		const dns = json.Answer
		let mddrs = []
		for(const dnsitem of dns){
			const arr = dnsitem.data.split('=')
			const dnsaddr = arr[1]
			const maddr = multiaddr(dnsaddr)
			mddrs.push(maddr)
		}
		this.#dialWebtransport(mddrs)
		this.#dialWebsocket(mddrs)
		this.#isDialWebtransportOnly = false
		this.#dialedKnownBootstrap.set(id,mddrs)
	}
	
	
	//Dial only webtransport multiaddrs
	async #dialWebtransport(multiaddrs){
			const webTransportMadrs = multiaddrs.filter((maddr) => maddr.protoNames().includes('webtransport')&&maddr.protoNames().includes('certhash'))
			  for (const addr of webTransportMadrs) {
				try {
				  //console.log(`attempting to dial webtransport multiaddr: %o`, addr)
				  await this.#libp2p.dial(addr)
				  return // if we succeed dialing the peer, no need to try another address
				} catch (error) {
				  //console.log(`failed to dial webtransport multiaddr: %o`, addr)
				}
			  }
	}
	
	
	//Dial only websocket multiaddrs
	async #dialWebsocket(multiaddrs){
			const webSocketMadrs = multiaddrs.filter((maddr) => maddr.protoNames().includes('wss'))
			  for (const addr of webSocketMadrs) {
				try {
				  //console.log(`attempting to dial websocket multiaddr: %o`, addr)
				  await this.#libp2p.dial(addr)
				  return // if we succeed dialing the peer, no need to try another address
				} catch (error) {
				  //console.log(`failed to dial websocket multiaddr: %o`, addr)
				}
			  }
	}
	
	
	//Entry point to webpeerjs
	static async createWebpeer(){
		
		const blockstore = new IDBBlockstore(config.CONFIG_BLOCKSTORE_PATH)
		//await blockstore.destroy()
		await blockstore.open()
		const datastore = new IDBDatastore(config.CONFIG_DATASTORE_PATH)
		//await datastore.destroy()
		await datastore.open()
		
		const dbstore = new IDBDatastore(config.CONFIG_DBSTORE_PATH)
		await dbstore.open()
		
		
		//Create libp2p instance
		const libp2p = await createLibp2p({
			//datastore,
			addresses: {
				listen: [
				],
			},
			transports:[
				webTransport(),		
				//webSockets(),
				circuitRelayTransport({
					discoverRelays: config.CONFIG_DISCOVER_RELAYS,
				}),
			],
			connectionManager: {
				maxConnections: config.CONFIG_MAX_CONNECTIONS,
				minConnections: config.CONFIG_MIN_CONNECTIONS,
				inboundConnectionThreshold: 50,
				maxIncomingPendingConnections: 10,
				maxParallelDials: 150, 
				maxDialsPerPeer: 4, 
				dialTimeout: 10e3
			},
			connectionEncryption: [noise()],
			streamMuxers: [
				yamux({
					maxInboundStreams: 50,
					maxOutboundStreams: 50,
				})
			],
			connectionGater: {
				filterMultiaddrForPeer: async (peer, multiaddrTest) => {
					const multiaddrString = multiaddrTest.toString();
					if (
						multiaddrString.includes("/ip4/127.0.0.1") ||
						multiaddrString.includes("/ip6/")
					) {
						return false;
					}
					return true;
				},
				denyDialMultiaddr: async (multiaddrTest) => {
					const multiaddrString = multiaddrTest.toString();
					if (
						multiaddrString.includes("/ip4/127.0.0.1") ||
						multiaddrString.includes("/ip6/")
					) {
						return true;
					}
					return false;
				},
			},
			peerDiscovery: [
				pubsubPeerDiscovery({
					interval: 10_000,
					topics: config.CONFIG_PUBSUB_PEER_DISCOVERY,
					listenOnly: false,
				}),
			],
			services: {
				pubsub: gossipsub({
					allowPublishToZeroTopicPeers: true,
					msgIdFn: msgIdFnStrictNoSign,
					ignoreDuplicatePublishError: true,
				}),
			  
				identify: identify(),
				identifyPush: identifyPush(),
				aminoDHT: kadDHT({
					protocol: '/ipfs/kad/1.0.0',
					peerInfoMapper: removePrivateAddressesMapper,
					clientMode: false
				})
			},
			peerStore: {
				persistence: true,
				threshold: 1
			}
		})
		
		
		
		//console.log(`Node started with id ${libp2p.peerId.toString()}`)

		
		//Create helia ipfs instance
		const helia = await createHelia({
			datastore,
			blockstore,
			libp2p
		})
		
		await helia.libp2p.services.aminoDHT.setMode("server")
		
		
		//Return webpeerjs class
		return new webpeerjs(helia,dbstore)
	}
}


//Add id to pupsub message
async function msgIdFnStrictNoSign(msg){
  var enc = new TextEncoder()
  const signedMessage = msg
  const encodedSeqNum = enc.encode(signedMessage.sequenceNumber.toString())
  return await sha256.encode(encodedSeqNum)
}


//Export module
export default webpeerjs
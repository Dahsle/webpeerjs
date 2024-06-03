import * as config from  './config'

import { Peer as PBPeer } from '#/pubsub-peer-discovery/peer.js'

import { Key } from 'interface-datastore'

import { sha256 } from 'multiformats/hashes/sha2'



const prefix = config.CONFIG_PREFIX

export const mkErr = msg => new Error(`${prefix}: ${msg}`)

export {PBPeer}

export function uint8ArrayToString(uint8Array){
	const string = new TextDecoder().decode(uint8Array)
	return string
}

export function uint8ArrayFromString(string){
	const uint8Array = new TextEncoder().encode(string)
	return uint8Array
}

export function first(farr){
	return new Promise(async function(myResolve, myReject) {
		for await(const data of farr){
			myResolve(data)
			break
		}
	});	
}

export {Key}

//Add id to pupsub message
export async function msgIdFnStrictNoSign(msg){
  var enc = new TextEncoder()
  const signedMessage = msg
  const encodedSeqNum = enc.encode(signedMessage.sequenceNumber.toString())
  return await sha256.encode(encodedSeqNum)
}

let totals = {
    readyErrored: 0,
    noiseErrored: 0,
    upgradeErrored: 0,
    readyTimedout: 0,
    noiseTimedout: 0,
    success: 0
}

let stats = {
    pending: 0,
    open: 0,

    ready_error: 0,
    noise_error: 0,
    upgrade_error: 0,

    ready_timeout: 0,
    noise_timeout: 0,

    close: 0,
    abort: 0,
    remote_close: 0,
}

let lastStats = {
    pending: 0,
    ready_error: 0,
    noise_error: 0,
    upgrade_error: 0,
    close: 0,
    remote_close: 0,
    ready: 0,
    abort: 0,
    ready_timeout: 0,
    noise_timeout: 0,
    open: 0
}

let isDialEnabled = true
let lastfailtreshold = 0

export function metrics(data){
	try{
		const webTransportEvents = data.libp2p_webtransport_dialer_events_total
		
		const newPending = (webTransportEvents.pending ?? 0) - (lastStats.pending ?? 0)
		const newReadyError = (webTransportEvents.ready_error ?? 0) - (lastStats.ready_error ?? 0)
		const newNoiseError = (webTransportEvents.noise_error ?? 0) - (lastStats.noise_error ?? 0)
		const newUpgradeError = (webTransportEvents.upgrade_error ?? 0) - (lastStats.upgrade_error ?? 0)
		const newClose = (webTransportEvents.close ?? 0) - (lastStats.close ?? 0)
		const newReady = (webTransportEvents.ready ?? 0) - (lastStats.ready ?? 0)
		const newAbort = (webTransportEvents.abort ?? 0) - (lastStats.abort ?? 0)
		const newReadyTimeout = (webTransportEvents.ready_timeout ?? 0) - (lastStats.ready_timeout ?? 0)
		const newNoiseTimeout = (webTransportEvents.noise_timeout ?? 0) - (lastStats.noise_timeout ?? 0)
		const newOpen = (webTransportEvents.open ?? 0) - (lastStats.open ?? 0)
		const newRemoteClose = (webTransportEvents.remote_close ?? 0) - (lastStats.remote_close ?? 0)

		stats.pending += newPending
		stats.pending -= newReadyTimeout
		stats.pending -= newNoiseTimeout
		stats.pending -= newReadyError
		stats.pending -= newNoiseError
		stats.pending -= newUpgradeError
		stats.pending -= newOpen

		stats.open += newOpen
		stats.open -= newClose
		stats.open -= newRemoteClose
		stats.open -= newAbort

		stats.ready_error = newReadyError
		stats.noise_error = newNoiseError
		stats.upgrade_error = newUpgradeError
		stats.ready_timeout = newReadyTimeout
		stats.noise_timeout = newNoiseTimeout
		stats.close = newClose
		stats.abort = newAbort
		stats.remote_close = newRemoteClose

		totals.success += newReady
		totals.readyErrored += newReadyError
		totals.noiseErrored += newNoiseError
		totals.upgradeErrored += newUpgradeError
		totals.readyTimedout += newReadyTimeout
		totals.noiseTimedout += newNoiseTimeout

		const errors = totals.readyErrored + totals.noiseErrored + totals.upgradeErrored
		const timeouts = totals.readyTimedout + totals.noiseTimedout
		const failureRate = ((errors + timeouts) / (errors + timeouts + totals.success) * 100).toFixed(2)
		
		lastStats = webTransportEvents
		
		const fail = errors+timeouts
		const treshold = errors+timeouts+stats.open+stats.pending
		
		if(treshold>50){
			//console.log(`Treeshold hit : ${treshold}`)
		}
		
		if(fail>50){
			//console.log(`Open : ${stats.open} , Pending : ${stats.pending} , Succes : ${totals.success} , Fail : ${fail} `)

		}
		
		if ((fail-lastfailtreshold)>50){
			isDialEnabled = false
			console.log('isDialEnabled',isDialEnabled)
			setTimeout(()=>{
				isDialEnabled = true
				lastfailtreshold = fail
				console.log('isDialEnabled',isDialEnabled)
			},6*60*1000)
		}
		
		return isDialEnabled
		
	}
	catch(e){}
}
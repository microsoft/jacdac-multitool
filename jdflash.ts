
namespace jdflash {
    const BL_CMD_PAGE_DATA = 0x80
    const BL_CMD_SET_SESSION = 0x81
    const BL_SUBPAGE_SIZE = 208

    const numRetries = 3


    function log(msg: string) {
        console.log(msg)
    }

    export class FlashClient extends jacdac.Client {
        private pageSize: number
        private flashSize: number
        private pageBuffer: Buffer
        private offset: number
        private sessionId: number
        private classClients: FlashClient[]
        private pageAddr: number
        private lastStatus: jacdac.JDPacket
        private pending: boolean
        public dev_class: number

        constructor(adpkt: jacdac.JDPacket) {
            super("jdbl", jd_class.BOOTLOADER, ".bootloader")
            const d = adpkt.data.toArray(NumberFormat.UInt32LE)
            this.pageSize = d[1]
            this.flashSize = d[2]
            this.dev_class = d[3]
            this.requiredDeviceName = adpkt.device_identifier
        }

        handlePacket(pkt: jacdac.JDPacket) {
            if (pkt.service_command == BL_CMD_PAGE_DATA)
                this.lastStatus = pkt
        }

        startFlash() {
            this.sessionId = Math.randomRange(0, 0x10000000)
            for (let d of this.classClients) {
                d.start()
                log(`flashing ${d.requiredDeviceName}; available flash=${d.flashSize / 1024}kb; page=${d.pageSize}b`)
            }
            this.offset = 0

            pauseUntil(() => this.classClients.every(c => c.isConnected()))
            log(`all connected`)

            const setsession = jacdac.JDPacket.packed(BL_CMD_SET_SESSION, "I", [this.sessionId])

            this.allPending()

            for (let i = 0; i < numRetries; ++i) {
                for (let d of this.classClients) {
                    if (d.pending) {
                        if (d.lastStatus && d.lastStatus.getNumber(NumberFormat.UInt32LE, 0) == this.sessionId) {
                            d.pending = false
                        } else {
                            d.lastStatus = null
                            log(`set session on ${d.device}`)
                            d.sendCommand(setsession)
                        }
                        pause(5)
                    }
                }
                if (this.numPending() == 0)
                    break
                this.waitForStatus()
            }

            if (this.numPending())
                throw "Can't set session id"
        }

        endFlash() {
            if (this.offset != 0)
                this.flush()
            log(`done flashing ${this.device}; resetting`)

            const rst = jacdac.JDPacket.onlyHeader(jacdac.CMD_CTRL_RESET)
            for (let f of this.classClients)
                f.sendCommand(rst)
        }

        private allPending() {
            for (let c of this.classClients) {
                c.pending = true
                c.lastStatus = null
            }
        }

        private numPending() {
            let num = 0
            for (let c of this.classClients)
                if (c.pending) num++
            return num
        }

        private waitForStatus() {
            for (let i = 0; i < 100; ++i) {
                if (this.classClients.every(c => c.lastStatus != null))
                    break
                pause(5)
            }
        }

        private flush() {
            const pageSize = this.pageSize
            const pageAddr = this.pageAddr
            const numSubpage = ((pageSize + BL_SUBPAGE_SIZE - 1) / BL_SUBPAGE_SIZE) | 0

            this.offset = 0

            log(`flash at ${pageAddr & 0xffffff}`)

            for (let f of this.classClients)
                f.lastStatus = null

            this.allPending()
            for (let i = 0; i < numRetries; ++i) {
                let currSubpage = 0
                for (let suboff = 0; suboff < pageSize; suboff += BL_SUBPAGE_SIZE) {
                    let sz = BL_SUBPAGE_SIZE
                    if (suboff + sz > pageSize)
                        sz = pageSize - suboff
                    const hd = Buffer.pack("IHBB5I", [pageAddr, suboff, currSubpage++, numSubpage - 1, this.sessionId, 0, 0, 0, 0])
                    control.assert(hd.length == 4 * 7, 11)
                    const p = jacdac.JDPacket.from(BL_CMD_PAGE_DATA, hd.concat(this.pageBuffer.slice(suboff, sz)))

                    // in first round, just broadcast everything
                    // in other rounds, broadcast everything except for last packet
                    if (i == 0 || currSubpage < numSubpage)
                        p.sendAsMultiCommand(jd_class.BOOTLOADER)
                    else {
                        for (let f of this.classClients)
                            if (f.pending) {
                                f.lastStatus = null
                                f.sendCommand(p)
                            }
                    }
                    pause(5)
                }

                this.waitForStatus()

                for (let f of this.classClients) {
                    if (f.pending) {
                        let err = ""
                        if (f.lastStatus) {
                            const [sess, berr, pageAddr] = f.lastStatus.data.unpack("III")
                            if (sess != this.sessionId)
                                err = "invalid session_id"
                            else if (pageAddr != this.pageAddr)
                                err = "invalid page address"
                            else if (berr)
                                err = "err:" + berr
                        } else {
                            err = "timeout"
                        }
                        if (err) {
                            f.lastStatus = null
                            log(`retry ${f.device}: ${err}`)
                        } else {
                            f.pending = false
                        }
                    }
                }

                if (this.numPending() == 0) {
                    this.pageAddr = null
                    return
                }
            }

            throw "too many retries"
        }

        everyoneConnected() {
            return !this.classClients.find(f => !f.isConnected())
        }

        addChunk(addr: number, data: Buffer) {
            pauseUntil(() => this.everyoneConnected(), 5000)
            if (!this.everyoneConnected())
                throw "Can't connect"

            const off = addr & (this.pageSize - 1)
            if (off != this.offset)
                throw "misaligned"
            const page = addr - off
            if (this.pageAddr != null && this.pageAddr != page)
                throw "page not done"
            this.pageAddr = page
            if (off == 0) {
                if (this.pageBuffer)
                    this.pageBuffer.fill(0)
                else
                    this.pageBuffer = Buffer.create(this.pageSize)
            }
            this.pageBuffer.write(off, data)
            this.offset = off + data.length
            if (this.offset == this.pageSize)
                this.flush()
        }

        public static forDeviceClass(dev_class: number) {
            if (!flashers)
                makeBootloaderList()
            const all = flashers.filter(f => f.dev_class == dev_class)
            if (all.length > 0)
                all[0].classClients = all
            return all[0]
        }
    }

    let flashers: FlashClient[]
    function onPacket(p: jacdac.JDPacket) {
        if (!p.is_command &&
            p.service_number == 1 &&
            p.service_command == jacdac.CMD_ADVERTISEMENT_DATA &&
            p.data.getNumber(NumberFormat.UInt32LE, 0) == jd_class.BOOTLOADER
        ) {
            if (!flashers.find(f => f.requiredDeviceName == p.device_identifier))
                flashers.push(new FlashClient(p))
        }
    }

    function makeBootloaderList() {
        log("resetting all devices")

        const rst = jacdac.JDPacket.onlyHeader(jacdac.CMD_CTRL_RESET)
        rst.sendAsMultiCommand(jd_class.CTRL)

        log("asking for bootloaders")

        if (!flashers) {
            flashers = []
            jacdac.onRawPacket(onPacket)
        } else {
            for (let f of flashers) f.destroy()
            flashers = []
        }

        const bl_announce = jacdac.JDPacket.onlyHeader(jacdac.CMD_ADVERTISEMENT_DATA)
        // collect everyone for 1s
        for (let i = 0; i < 10; ++i) {
            bl_announce.sendAsMultiCommand(jd_class.BOOTLOADER)
            pause(100)
        }

        if (flashers.length == 0) {
            log("no bootloaders reported; trying for another 10s")

            // the user is meant to connect their device now
            for (let i = 0; i < 100; ++i) {
                bl_announce.sendAsMultiCommand(jd_class.BOOTLOADER)
                pause(100)
                // but we stop on the first encountered device
                if (flashers.length > 0)
                    break
            }
        }

        if (flashers.length == 0)
            throw "no devices to flash"

        log(`${flashers.length} bootloader(s) found; [0]:${hexNum(flashers[0].dev_class)}`)
    }


    let skippingFamilyId = -1
    let currFlasher: FlashClient
    export function handleUF2Block(blk: Buffer) {
        const hh = blk.slice(0, 32)
        const [_magic0, _magic1, _flags, trgaddr, payloadSize, blkNo, numBlocks, familyID] = hh.toArray(NumberFormat.UInt32LE)
        if (skippingFamilyId == familyID)
            return
        // control.dmesg(`uf2: ${hexNum(_magic0)} ${blkNo}/${numBlocks} fam=${hexNum(familyID)}`)
        if (blkNo == 0) {
            if (currFlasher)
                currFlasher.endFlash()
            currFlasher = FlashClient.forDeviceClass(familyID)
            if (!currFlasher) {
                log(`skipping family ${hexNum(familyID)} - no bootloaders for it`)
                skippingFamilyId = familyID
                return
            }
            currFlasher.startFlash()
        }

        if (!currFlasher || currFlasher.dev_class != familyID)
            throw "invalid UF2"

        currFlasher.addChunk(trgaddr, blk.slice(32, payloadSize))
        if (blkNo == numBlocks - 1) {
            currFlasher.endFlash()
            currFlasher = null
        }
    }
}


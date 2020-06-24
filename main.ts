let dns: jacdac.DeviceNameClient

function describe(dev: jacdac.Device) {
    let name = ""
    if (dev == jacdac.selfDevice())
        name = "<self>"
    else if (dns) {
        const bound = dns.remoteRequestedDevices.find(d => d.boundTo == dev)
        if (bound) name = "(" + bound.name + ")"
    }
    return `${dev.shortId} ${name}`
}

function describeRemote(dev: jacdac.RemoteRequestedDevice) {
    let bnd = dev.boundTo ? dev.boundTo.shortId : ""
    const n = dev.candidates.filter(c => c != dev.boundTo).length
    if (n) {
        if (bnd) bnd += "+" + n
        else bnd = "" + n
    }
    if (bnd) bnd = "(" + bnd + ")"
    return `${dev.name} ${bnd}`
}

function identify(d: jacdac.Device) {
    if (!d) return
    if (d == jacdac.selfDevice())
        control.runInBackground(jacdac.onIdentifyRequest)
    else
        d.sendCtrlCommand(jacdac.CMD_CTRL_IDENTIFY)
}

function selectDevice(fun: string, cond: (dev: jacdac.Device) => boolean) {
    let res: jacdac.Device = undefined
    let devs: jacdac.Device[]
    menu.show({
        title: "Function: " + fun,
        footer: "A = select, -> = identify",
        update: opts => {
            devs = jacdac.devices().filter(cond)
            opts.elements = devs.map(d => menu.item(describe(d), opts => {
                res = d
                menu.exit(opts)
            }, () => identify(d)))
        }
    })
    return res
}

function operateDNS(ourDNS: jacdac.Device) {
    dns = new jacdac.DeviceNameClient(ourDNS.deviceId)
    dns.scan()

    menu.show({
        title: "Bind function",
        update: opts => {
            opts.elements = dns.remoteRequestedDevices
                .filter(r => r.name && r.name[0] != ".")
                .map(r =>
                    menu.item(describeRemote(r), () => {
                        const newD = selectDevice(r.name, d => r.isCandidate(d))
                        r.select(newD)
                    }))
            opts.elements.push(menu.item("Clear all names", () => {
                dns.clearNames()
                resetAll() // and reset everyone, just in case
            }))
        }
    })
}

function allDNSes() {
    return jacdac.devices().filter(hasDNS)
    function hasDNS(d: jacdac.Device) {
        return d.hasService(jd_class.DEVICE_NAME_SERVICE)
    }
}

function resetAll() {
    jacdac.JDPacket.onlyHeader(jacdac.CMD_CTRL_RESET)
        .sendAsMultiCommand(jd_class.CTRL)
}

let consoleClient: jacdac.ConsoleClient

function showConsole() {
    game.pushScene() // black bg
    game.consoleOverlay.setVisible(true)
}

function hideConsole() {
    console.log("B to exit...")
    let done = false
    controller.B.onEvent(ControllerButtonEvent.Pressed, () => {
        done = true
    })
    pauseUntil(() => done)
    game.consoleOverlay.setVisible(false)
    game.popScene()
}

function startConsole() {
    if (!consoleClient) {
        consoleClient = new jacdac.ConsoleClient()
        consoleClient.minPriority = JDConsolePriority.Debug
        consoleClient.start()
    }
    showConsole()
    hideConsole()
}

function wifi() {
    showConsole()

    console.log("WiFi starting...")
    net.logPriority = ConsolePriority.Log
    const n = net.instance()
    const cl = n.controller
    cl.connect()
    pauseUntil(() => cl.isConnected)
    console.log("connected; MAC:" + cl.MACaddress.toHex())

    const resp = net.get("https://pxt.io/api/ping")
    console.log("resp: " + resp.toString())


    hideConsole()
}

function deviceBrowser() {
    let devs: jacdac.Device[] = []
    menu.show({
        title: "JACDAC browser",
        footer: "A=view, > test, < ID",
        update: opts => {
            devs = jacdac.devices()
            devs.sort((a, b) => a.shortId.compare(b.shortId))
            opts.elements = devs.map(d => menu.item(describe(d), () => deviceView(d),
                () => testDevice(d), () => identify(d)))
        }
    })
}

interface FnMap {
    [index: string]: () => void;
}

function mainMenu() {
    menu.show({
        title: "JACDAC tool",
        update: opts => {
            opts.elements = allDNSes().map(d => menu.item("DNS: " + describe(d), () => operateDNS(d)))
            opts.elements.push(menu.item("Device browser", deviceBrowser))
            opts.elements.push(menu.item("WiFi", wifi))
            opts.elements.push(menu.item("Console", startConsole))
            opts.elements.push(menu.item("Reset all devices", resetAll))
        }
    })
}

function main() {
    jacdac.start()
    menu.wait(1000, "Scanning...")
    mainMenu()
}

function initUF2() {
    let lastWrite = 0
    console.addListener((pri, txt) => control.dmesg("C: " + txt.slice(0, -1)))
    jacdac.consolePriority = ConsolePriority.Log
    appuf2.init({
        files: {
            "readme.txt": "Drop .UF2 files here with JACDAC firmware!",
            "jd-uf2.txt": "Auto-detect"
        },
        volumeLabel: "JACDAC UF2",
        writeHandler: buf => {
            if (!lastWrite) {
                game.pushScene() // clear screen
                game.consoleOverlay.setVisible(true)
                console.log("starting UF2 flash over JACDAC")
            }
            lastWrite = 0 // don't reset while we're flashing this block
            jdflash.handleUF2Block(buf)
            lastWrite = control.millis()
        }
    })
    jacdac.onAnnounce(() => {
        if (lastWrite && control.millis() - lastWrite > 1000) {
            lastWrite = 0
            console.log("ending flash... press any key")
            resetAll() // just in case
            pauseUntil(() => controller.anyButton.isPressed())
            control.reset() // and ourselves, to clear the UF2 cached in the host
        }
    })
}

initUF2()
control.runInBackground(main)

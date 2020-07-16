class ServiceDesc {
    constructor(
        public classNum: number,
        public name: string,
        public testFn?: (num: number) => void,
        public viewFn?: (d: jacdac.Device, s: ServiceDesc) => void
    ) {
        this.viewFn = viewFn || sensorView
    }
}

const serviceDescs = [
     new ServiceDesc(jd_class.ACCELEROMETER, "acc",
        num => jacdac.accelerometerClient.setStreaming(num & 1 ? true : false)),
    new ServiceDesc(jd_class.RGB_LED, "RGBLED",
        num => jacdac.rgbledClient.setColor(randint(0, 0xffffffff))),
    new ServiceDesc(jd_class.LIGHT, "light", (num) => {
        const cl = jacdac.lightClient
        cl.setBrightness(10)
        cl.setStrip(128, jacdac.LightType.WS2812B_GRB)

        const duration = 30 * 1000
        //cl.showAnimation(new jacdac.lightanimation.ColorWipe, duration)

        switch (num % 8) {
            case 0:
                cl.runEncoded("setall #000000")
                break
            case 1:
                cl.showAnimation(new jacdac.lightanimation.Comet, duration)
                break
            case 2:
                cl.showAnimation(new jacdac.lightanimation.Fireflys, duration)
                break
            case 3:
                cl.showAnimation(new jacdac.lightanimation.RainbowCycle, duration)
                break
            case 4:
                cl.showAnimation(new jacdac.lightanimation.RunningLights, duration)
                break
            case 5:
                cl.showAnimation(new jacdac.lightanimation.Sparkle, duration)
                break
            case 6:
                cl.showAnimation(new jacdac.lightanimation.TheaterChase, duration)
                break
            case 7:
                cl.showAnimation(new jacdac.lightanimation.ColorWipe, duration)
                break
        }


        //pause(500)
        //cl.setAll(0x0)
        //jacdac.monoLightClient.setBrightness(0)
    }),
    new ServiceDesc(jd_class.SERVO, "servo", num =>
        (num & 3) == 0 ? jacdac.servoClient.turnOff() :
            jacdac.servoClient.setAngle(num & 1 ? 90 : 45)),
    new ServiceDesc(jd_class.MOTOR, "motor", num =>
        jacdac.motorClient.run(((num % 11) - 5) * 20)),
    new ServiceDesc(jd_class.PWM_LIGHT, "glo", num => {
        jacdac.monoLightClient.setBrightness(num & 1 ? 50 : 0)
        jacdac.monoLightClient.setIterations(1)
        jacdac.monoLightClient.showAnimation(jacdac.mono.slowGlow)
    }),
    new ServiceDesc(jd_class.LOGGER, "logger"),
    new ServiceDesc(jd_class.ROTARY_ENCODER, "crank",
        num => jacdac.rotaryEncoderClient.setStreaming(num & 1 ? true : false)),
    new ServiceDesc(jd_class.BUTTON, "btn", num =>{}, buttonView),
    new ServiceDesc(jd_class.MUSIC, "music",
        num => jacdac.musicClient.playMelody(music.jumpDown, 20)),
]

class RawSensorClient extends jacdac.SensorClient {
    constructor(name: string, deviceClass: number, requiredDevice: string) {
        super(name, deviceClass, requiredDevice)
    }
}

function sensorView(d: jacdac.Device, s: ServiceDesc) {
    const client = new RawSensorClient(s.name, s.classNum, d.deviceId)
    const reading = menu.item("Reading: ", () => { })
    client.setStreaming(true)
    client.onStateChanged(() => {
        reading.name = "Reading: " + jacdac.intOfBuffer(client.state)
    })

    menu.show({
        title: "Device: " + d.shortId + " / " + s.name,
        update: opts => {
            opts.elements = [reading]
            if (!d.isConnected)
                menu.exit(opts)
        }
    })

    client.destroy()
}

function buttonView(d: jacdac.Device, s: ServiceDesc) {
    const buttonState = menu.item("State: ", () => { })

    jacdac.buttonClient.onEvent(JDButtonEvent.Click, () => {
        buttonState.name += ", Click"
    })

    jacdac.buttonClient.onEvent(JDButtonEvent.LongClick, () => {
        buttonState.name += ", Long click"
    })

    jacdac.buttonClient.onEvent(JDButtonEvent.Down, () => {
        buttonState.name = "Down"
    })

    jacdac.buttonClient.onEvent(JDButtonEvent.Up, () => {
        buttonState.name = "Up"
    })

    jacdac.buttonClient.onEvent(JDButtonEvent.Hold, () => {
        buttonState.name = "Hold"
    })

    menu.show({
        title: "Device: " + d.shortId + " / " + s.name,
        update: opts => {
            opts.elements = [buttonState]
            if (!d.isConnected)
                menu.exit(opts)
        }
    })
}

function hexNum(n: number) {
    const hex = "0123456789abcdef"
    let r = "0x"
    for (let i = 0; i < 8; ++i) {
        r += hex[(n >>> ((7 - i) * 4)) & 0xf]
    }
    return r
}

let testDevN = 0
let lastDev: jacdac.Device
function testDevice(d: jacdac.Device) {
    if (d == jacdac.selfDevice())
        return
    if (d != lastDev)
        testDevN = 1
    else
        testDevN++
    lastDev = d
    for (let i = 4; i < d.services.length; i += 4) {
        const id = d.services.getNumber(NumberFormat.UInt32LE, i)
        let s = serviceDescs.find(s => s.classNum == id)
        if (s && s.testFn) {
            s.testFn(testDevN)
        }
    }
}

function deviceView(d: jacdac.Device) {
    if (d == jacdac.selfDevice())
        return
    const services: ServiceDesc[] = []
    for (let i = 4; i < d.services.length; i += 4) {
        const id = d.services.getNumber(NumberFormat.UInt32LE, i)
        let s = serviceDescs.find(s => s.classNum == id)
        if (!s)
            s = new ServiceDesc(id, "Service: " + hexNum(id), () => { })
        services.push(s)
    }

    let num = 0

    function noop() { }

    menu.show({
        title: "Device: " + d.shortId,
        footer: "A = select, -> = test service",
        update: opts => {
            opts.elements = []
            opts.elements.push(menu.item(d.classDescription, noop))
            opts.elements.push(menu.item(d.firmwareVersion, noop))
            opts.elements.push(menu.item("Temp: " + (d.temperature || "?") + "C", noop))
            opts.elements.push(menu.item("Identify", () => identify(d)))
            opts.elements.push(menu.item("---", noop))
            opts.elements = opts.elements.concat(services.map(s => menu.item(s.name, () => {
                s.viewFn(d,s)
            }, opts => {
                if (s.testFn) {
                    s.testFn(++num)
                    opts.title = "Device: " + d.shortId + " T:" + num
                }
            })))

            if (!d.isConnected)
                menu.exit(opts)
        }
    })
}


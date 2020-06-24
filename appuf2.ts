namespace appuf2 {
    export interface Files {
        [name: string]: string;
    }

    export interface Options {
        files?: Files;
        writeHandler?: (buf: Buffer) => void;
        volumeLabel?: string;
    }

    //% shim=pxt::initUserUF2
    function initUserUF2(files: any) { }

    export function init(opts: Options) {
        const cppopts: any = {}
        if (opts.files)
            for (let k of Object.keys(opts.files)) {
                cppopts[k] = opts.files[k]
            }
        if (opts.volumeLabel)
            cppopts[".volume"] = opts.volumeLabel
        if (opts.writeHandler)
            cppopts[".write"] = opts.writeHandler

        initUserUF2(cppopts)
    }
}

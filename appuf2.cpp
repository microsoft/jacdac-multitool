#include "pxt.h"
#include "GhostFAT.h"
#include "uf2format.h"

#define LOG DMESG

namespace pxt {

#if CONFIG_ENABLED(DEVICE_USB)

class UserUF2 : public codal::GhostFAT {
  protected:
    RefMap *files;
    const char *vol;
    Action writeCB;

  public:
    UserUF2(RefMap *files) : files(files) {
        // TODO we should somehow freeze it or clone it...
        registerGCObj(files);
        vol = "APP UF2";
        writeCB = NULL;
    }

    virtual void addFiles();
    virtual void writeBlocks(int blockAddr, int numBlocks);
    virtual const char *volumeLabel() { return vol; }
};

void UserUF2::writeBlocks(int blockAddr, int numBlocks) {
    uint8_t buf[512];

    while (numBlocks--) {
        readBulk(buf, sizeof(buf));
        if (is_uf2_block(buf) && writeCB) {
            pxt::runAction1(writeCB, (TValue)mkBuffer(buf, sizeof(buf)));
        }
        blockAddr++;
    }

    finishReadWrite();
}

void UserUF2::addFiles() {
    codal::GhostFAT::addFiles();
    for (unsigned i = 0; i < files->keys.getLength(); ++i) {
        auto k = files->keys.get(i);
        auto v = files->values.get(i);
        if (valType(k) != ValType::String)
            continue;
        auto ks = ((String)k)->getUTF8Data();

        if (strcmp(ks, ".write") == 0 && valType(v) == ValType::Function) {
            writeCB = (Action)v;
        } else if (valType(v) == ValType::String) {
            auto vs = ((String)v)->getUTF8Data();
            if (ks[0] != '.')
                addStringFile(vs, ks);
            else if (strcmp(ks, ".volume") == 0)
                vol = vs;
        }
    }
}

//% expose
void initUserUF2(RefMap *map) {
    DMESG("UF2 start %d", (int)system_timer_current_time());
    auto msc = new UserUF2(map);
    msc->addFiles();
    int r = usb.add(*msc);
    if (r)
        target_panic(PANIC_CODAL_USB_ERROR);
}

#else

void initUserUF2(RefMap *) {
    // ignore
}

#endif

} // namespace pxt

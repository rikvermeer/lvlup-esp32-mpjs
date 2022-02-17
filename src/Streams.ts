export const readableEventStream = (evt: EventTarget, name: string) => {
    let callback: (e: Event) => void
    return new ReadableStream({
        start(controller) {
            callback = (e) => {
                //console.trace('callback',(e as CustomEvent).detail)
                controller.enqueue((e as CustomEvent).detail)
            }
            evt.addEventListener(name, callback)
        },
        pull(controller) {

        },
        cancel(reason?) {
            evt.removeEventListener(name, callback)
        },
    })
}
import eventBus from "./EventBus";

// Creates an event on incoming chunk
class EventTransformStream extends TransformStream<ReadableStream, WritableStream> {
    constructor(public readonly event: string) {
        super({
            start() {
            }, // required.

            async transform(chunk: any, controller: TransformStreamDefaultController) {
                chunk = await chunk
                eventBus.dispatch(event, chunk)
                controller.enqueue(chunk)
            },
            flush() { /* do any destructor work here */
            }})
    }
}



//Registers on an event to enqueues it's data into a readable
class EventReadable extends ReadableStream<any> {
    //private eventHandler: any;
    constructor(event: string) {
        super({
            // @ts-ignore
            eventHandler: undefined,
            start(controller) {
                // @ts-ignore
                this.eventHandler = (data: any) => controller.enqueue(data)
                // @ts-ignore
                eventBus.on(event, this.eventHandler)
            },
            pull(controller) {},
            cancel(controller) {
                // @ts-ignore
                eventBus.remove(event, this.eventHandler)
            }
        });
    }
}


export {EventTransformStream, EventReadable};
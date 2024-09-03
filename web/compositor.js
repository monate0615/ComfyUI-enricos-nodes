// author: erosdiffusionai@gmail.com
import {app} from "../../scripts/app.js";
import {api} from "../../scripts/api.js";

import {fabric} from "./fabric.js";

const COMPOSITOR = Symbol();
//const TEST_IMAGE_2 = "./extensions/ComfyUI-enricos-nodes/empty.png"

/**
 * Initialize a fabricJs instance.
 * Fabric is the engine that makes it possible to  manipulate the images
 * and extract the final composite image
 * init params: http://fabricjs.com/docs/fabric.Canvas.html
 * @param canvasId
 * @return {fabric.Canvas}
 */
const createCanvas = (node) => new fabric.Canvas(node.stuff.canvasId, {
    backgroundColor: 'transparent',
    selectionColor: 'transparent',
    selectionLineWidth: 1,
    // F-10 preserve object stacking
    preserveObjectStacking: true,
    altSelectionKey: "ctrlKey",
    altActionKey :"ctrlKey",
    centeredKey: "altKey",
    // centeredRotation: true,
    // centeredScaling: true,

    // dangerous if you want to move stuff outside view that's transparent
    // perPixelTargetFind: true,

});

/**
 *  moves the active object in the passed fabric canva
 * @param fcanvas the canvas to consider
 * @param direction array with [x,y] coords in range -1 +1 with 0 for no  movement
 * @param withShift
 */
function moveSelected(fcanvas, direction = [], withShift = false ) {
    // console.log(withShift)
    const Direction = {
        LEFT: 0,
        UP: 1,
        RIGHT: 2,
        DOWN: 3
    };
    const STEP = withShift ? 10 : 1;
    const activeObject = fcanvas.getActiveObject();
    if (activeObject) {
        activeObject.set({
            left: activeObject.left + direction[0] * STEP,
            top: activeObject.top + direction[1] * STEP,
        });
        fcanvas.renderAll();
        // console.log("selected objects are moved");
    }
}

/**
 * initialize compositor metadata/references in the node aka stuff!
 */
function initStuff(node, compositorId, CANVAS_BORDER_COLOR, COMPOSITION_BORDER_COLOR, COMPOSITION_BORDER_SIZE, COMPOSITION_BACKGROUND_COLOR, divContainer,canvasEl) {
    node.stuff = {
        canvasId: compositorId,
        container:divContainer,
        canvasEl:canvasEl,
        /** the fabric canvas */
        canvas: null,
        compositionBorder: null,
        c1: "",
        c2: "",
        /** contains the last image, i probably just need the hash anyways */
        cblob: undefined,
        /** contains the last uploaded image file name, will be sent again if hashes match (same content with cblob) */
        lastUpload: undefined,
        CANVAS_BORDER_COLOR: CANVAS_BORDER_COLOR,
        COMPOSITION_BORDER_COLOR: COMPOSITION_BORDER_COLOR,
        COMPOSITION_BORDER_SIZE: COMPOSITION_BORDER_SIZE,
        COMPOSITION_BACKGROUND_COLOR: COMPOSITION_BACKGROUND_COLOR,


    }
}
/** add more references */
function setupReferences(node, p, w, h, fcanvas, composite, img, compositionArea, compositionBorder, capture, captureOnQueue) {
    node.stuff.p = p;
    node.stuff.w = w;
    node.stuff.h = h;
    /** the fabric canvas:v */
    // node.stuff.v = v;
    node.stuff.canvas = fcanvas;
    node.stuff.composite = composite;
    node.stuff.i = img;
    node.stuff.compositionArea = compositionArea;
    node.stuff.compositionBorder = compositionBorder;
    node.stuff.capture = capture;
    node.stuff.captureOnQueue = captureOnQueue;
}

/**
 * takes a given dataURL and transforms into a binary large object
 */
function dataURLToBlob(dataURL) {
    const parts = dataURL.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const binary = atob(parts[1]);
    const array = [];
    for (let i = 0; i < binary.length; i++) {
        array.push(binary.charCodeAt(i));
    }
    return new Blob([new Uint8Array(array)], {type: mime});
}

/**
 * uploads the composite image passed as blob
 * via api to the /uppload/image enpoint as post
 * with option to save to the temp folder
 * @return the uploaded image filename
 */
const uploadImage = async (blob) => {
    const UPLOAD_ENDPOINT = "/upload/image";
    const name = `${+new Date()}.png`;
    const file = new File([blob], name);
    const body = new FormData();

    body.append("image", file);
    body.append("subfolder", "compositor");
    body.append("type", "temp");

    const resp = await api.fetchApi(UPLOAD_ENDPOINT, {
        method: "POST",
        body,
    });

    if (resp.status !== 200) {
        const err = `Error uploading composition image: ${resp.status} - ${resp.statusText}`;
        throw new Error(err);
    }
    /** return the last upload name */
    return `compositor/${name} [temp]`;
}

/**
 * calculates the widget size given the contents, a bit flaky
 * @param v the fabric canvas reference
 * @return the size array [w,h]
 */
const calculateWidgetSize = (v) => {
    //return [v.getWidth() + 100, v.getHeight() + 558];
    return [v.getWidth() + 21, v.getHeight() + 291];
}


/**
 * given a blob, calculate its checksum and returns as promise of string
 * @return cheksum string as promise
 */
async function getChecksumSha256(blob) {
    const uint8Array = new Uint8Array(await blob.arrayBuffer());
    const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Array);
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    return hashArray.map((h) => h.toString(16).padStart(2, '0')).join('');
}

/**
 * checks if there is anything in the node.stuff.cblob,
 * the previous generation would be stored there
 */
const neverRun = (node) => {
    return node.stuff.cblob == undefined
}

/**
 * the actual area of WxH dimensions that will be exported as output
 */
const createCompositionArea = (p, w, h, node) => {
    return new fabric.Rect({
        left: p.value,
        top: p.value,
        fill: node.stuff.COMPOSITION_BACKGROUND_COLOR,
        width: w.value,
        height: h.value,
        selectable: false,
    });
}




/**
 * checks if the reference at index for an image is not null
 * references are stored in "node.stuff"
 * @param node
 * @param index
 * @return {boolean}
 */
function stuffHasImageAtIndex(node, index) {
    return node.stuff[imageNameAt(index)] != null;
}

/**
 * returns a string in the format image1...
 * the array is zero based
 * but the named property is named after the input so 0 -> image1
 * @param index
 * @return {string}
 */
function imageNameAt(index) {
    return 'image' + (index + 1);
}

function getOldTransform(node, index) {
    return {
        left: node.stuff[imageNameAt(index)].left,
        top: node.stuff[imageNameAt(index)].top,
        scaleX: node.stuff[imageNameAt(index)].scaleX,
        scaleY: node.stuff[imageNameAt(index)].scaleY,
        angle: node.stuff[imageNameAt(index)].angle,
        flipX: node.stuff[imageNameAt(index)].flipX,
        flipY: node.stuff[imageNameAt(index)].flipY,
        originX: node.stuff[imageNameAt(index)].originX,
        originY: node.stuff[imageNameAt(index)].originY,
    };
}

/**
 * A non-interactive rectangle with trassparent content and
 * colored border around that frames the composition from the outside
 * and is overlaid on top of all passed images
 * the size and position are calculated given the width height and
 * COMPOSITION_BORDER_SIZE
 * COMPOSITION_BORDER_COLOR
 */
function createCompositionBorder(p, w, h, node) {
    const compositionBorder = new fabric.Rect({
        left: p.value - node.stuff.COMPOSITION_BORDER_SIZE,
        top: p.value - node.stuff.COMPOSITION_BORDER_SIZE,
        fill: 'transparent',
        width: w.value + node.stuff.COMPOSITION_BORDER_SIZE * 2,
        height: h.value + node.stuff.COMPOSITION_BORDER_SIZE * 2,
        selectable: false,
        evented: false,
    });

    compositionBorder.set("strokeWidth", node.stuff.COMPOSITION_BORDER_SIZE);
    compositionBorder.set("stroke", node.stuff.COMPOSITION_BORDER_COLOR);
    compositionBorder.set("selectable", false);
    compositionBorder.set("evented", false);

    node.stuff.compositionBorder = compositionBorder;
    return compositionBorder;
}

/**
 * generate a unique id...or try
 */
function getRandomCompositorUniqueId() {
    const randomUniqueIds = new Uint32Array(10);
    const compositorId = 'c_' + self.crypto.getRandomValues(randomUniqueIds)[0] + '_' + self.crypto.getRandomValues(randomUniqueIds)[1];
    return compositorId;
}

/**
 * use the app api to get settings for the Compositor node
 * settings are defined in the async setup(app) hook/lifecycle method
 * info on preferences https://docs.comfy.org/essentials/javascript_examples
 *
 * @param app
 * @return {{CANVAS_BORDER_COLOR, COMPOSITION_BACKGROUND_COLOR, COMPOSITION_BORDER_COLOR, COMPOSITION_BORDER_SIZE}} *
 */
function getCompositorSettings(app) {
    // let CANVAS_BORDER_COLOR = app.ui.settings.getSettingValue("Compositor.Canvas.BORDER_COLOR", "#FF0000B0");
    let CANVAS_BORDER_COLOR = app.ui.settings.getSettingValue("Compositor.Canvas.BORDER_COLOR", "rgba(255,153,0,0.00)");
    let COMPOSITION_BORDER_COLOR = app.ui.settings.getSettingValue("Compositor.Composition.BORDER_COLOR", "#00b300b0");
    let COMPOSITION_BORDER_SIZE = app.ui.settings.getSettingValue("Compositor.Composition.BORDER_SIZE", 2);
    let COMPOSITION_BACKGROUND_COLOR = app.ui.settings.getSettingValue("Compositor.Composition.BACKGROUND_COLOR", "rgba(0,0,0,0.2)");
    return {CANVAS_BORDER_COLOR, COMPOSITION_BORDER_COLOR, COMPOSITION_BORDER_SIZE, COMPOSITION_BACKGROUND_COLOR};
}

function createCompositorContainerDiv(node) {
    const container = document.createElement("div");
    container.style.background = "rgba(0,0,0,0.25)";
    container.style.textAlign = "center";

    return container;
}

function createCanvasElement(node) {
    const canvas = document.createElement("canvas");
    canvas.id = node.stuff.canvasId;
    node.resizable = false;
    return canvas;
}

function addCanvasBorderColorSetting(app) {
    app.ui.settings.addSetting({
        id: "Compositor.Canvas.BORDER_COLOR",
        name: "Border Color",
        tooltip: "give an hex code with alpha, e.g.: #00b300b0, it's the area controlled by 'padding' size outside the  output that will not be exported but used for manipulation",
        type: "text",
        defaultValue: "#00b300b0",
        onChange: (newVal, oldVal) => {
            console.log(newVal, this);
        },
    });
}

function addCompositionBorderColorSetting(app) {
    app.ui.settings.addSetting({
        id: "Compositor.Composition.BORDER_COLOR",
        name: "Border Color (not rendered)",
        type: "text",
        tooltip: "give hex code with alpha eg.: #00b300b0, this will help identifying what is withing the output",
        defaultValue: "#00b300b0",
        onChange: (newVal, oldVal) => {
            console.log(newVal, this);
        },
    });
}

function addCompositionBorderSizeSetting(app) {
    app.ui.settings.addSetting({
        id: "Compositor.Composition.BORDER_SIZE",
        name: "Border Size",
        type: "slider",
        attrs: {
            min: 0,
            max: 2,
            step: 1
        },
        defaultValue: 2,
        tooltip: "Border size, 0 for invisible, overlayed and unselectable, not part of the node ouptut",

        onChange: (newVal, oldVal) => {
            console.log(newVal, this);
        },
    });
}

function addCompositionBackgroundColorSetting(app) {
    app.ui.settings.addSetting({
        id: "Compositor.Composition.BACKGROUND_COLOR",
        name: "Background Color - Output",
        type: "text",
        tooltip: "give hex code with alpha eg.: #00b300b0, this will help identifying what is withing the output",
        defaultValue: "rgba(0,0,0,0.2)",
        onChange: (newVal, oldVal) => {
            console.log(newVal, this);
        },
    });
}

/** add muiltiple named settings */
function addCompositorSettings(app) {
    addCanvasBorderColorSetting.call(this, app);
    addCompositionBorderColorSetting.call(this, app);
    addCompositionBorderSizeSetting.call(this, app);
    addCompositionBackgroundColorSetting.call(this, app);
}

/** abstraction to get one widget by name in the node */
function getCompositorWidget(node, widgetName) {
    return node.widgets.find((w) => w.name === widgetName);
}

/** get all widgets we need, these are defined as params in the python file and passed to the node definition */
function getCompositorWidgets(node) {
    // const widgetName = "image";
    const composite = getCompositorWidget(node, "image");
    const w = getCompositorWidget(node, "width");
    const h = getCompositorWidget(node, "height");
    const p = getCompositorWidget(node, "padding");
    const captureOnQueue = getCompositorWidget(node, "capture_on_queue");
    return {composite, w, h, p, captureOnQueue};
}

function setupPaddingChangeCallback(p, compositionArea, h, w, compositionBorder, v) {
    p.origCallback = p.callback;
    p.callback = (padding, graphCanvas, node) => {
        // value is the padding value
        compositionArea.setHeight(h.value);
        compositionArea.setWidth(w.value);
        compositionArea.setLeft(padding);
        compositionArea.setTop(padding);

        compositionBorder.setHeight(h.value + node.stuff.COMPOSITION_BORDER_SIZE * 2);
        compositionBorder.setWidth(w.value + node.stuff.COMPOSITION_BORDER_SIZE * 2);
        compositionBorder.setLeft(padding - node.stuff.COMPOSITION_BORDER_SIZE);
        compositionBorder.setTop(padding - node.stuff.COMPOSITION_BORDER_SIZE);

        v.setHeight(compositionArea.getHeight() + (padding * 2));
        v.setWidth(compositionArea.getWidth() + (padding * 2));
        v.renderAll();
        node.setSize(calculateWidgetSize(v))
    }
}

function setupCaptureOnQueueCallback(captureOnQueue, compositionArea, h, w, compositionBorder, v) {
    captureOnQueue.origCallback = captureOnQueue.callback;
    captureOnQueue.callback = (captureOnQueue, graphCanvas, node) => {
        node.stuff.captureOnQueue.value = captureOnQueue.value;
    }
}

function setupHeightChangeCallback(h, v, p, compositionArea, compositionBorder) {
    h.origCalback = h.callback;
    // callback signature value, graphCanvas, node, pos, event
    h.callback = (value, graphCanvas, node) => {

        v.setHeight(value + (p.value * 2));
        compositionArea.setHeight(value);
        compositionBorder.setHeight(value + node.stuff.COMPOSITION_BORDER_SIZE * 2);

        node.setSize(calculateWidgetSize(v))
        v.renderAll();
    }
}

function setupWidthChangeCallback(w, v, p, compositionArea, compositionBorder) {
    w.origCalback = w.callback;
    w.callback = (value, graphCanvas, node) => {
        console.log("wcallback");
        v.setWidth(value + (p.value * 2));
        compositionArea.setWidth(value);
        compositionBorder.setWidth(value + node.stuff.COMPOSITION_BORDER_SIZE * 2);
        node.setSize(calculateWidgetSize(v));
        v.renderAll();
    }
}

/** check if this is a compositor node */
function isCompositor(node) {
    return node.constructor.comfyClass == "Compositor";
}

async function hasSameHash(node, blob) {
    node.stuff.c1 = await getChecksumSha256(node.stuff.cblob);
    node.stuff.c2 = await getChecksumSha256(blob);
    console.log(node.stuff.c1, node.stuff.c2, node.stuff.c1 == node.stuff.c2);
    node.stuff.sameHash = node.stuff.c1 == node.stuff.c2;
    console.log("new image ? ", node.stuff.sameHash ? "no, **same hash**" : "yes, different hash");
    return node.stuff.sameHash;

}

function addImageToStuff(node, index, theImage) {
    node.stuff[imageNameAt(index)] = theImage;
    node.stuff.canvas.add(theImage);
}

function replaceImageInStuff(node, index, theImage) {
    const oldTransform = getOldTransform(node, index);
    // Remove the old image from the canvas
    node.stuff.canvas.remove(node.stuff[imageNameAt(index)]);
    theImage.set(oldTransform);
    node.stuff.canvas.add(theImage);
    node.stuff[imageNameAt(index)] = theImage;
}

function isLeft(key) {
    return key === 37;
}

function isTop(key) {
    return key === 38;
}

function isRight(key) {
    return key === 39;
}

function isDown(key) {
    return key === 40;
}

function downDirection() {
    return [-1, 0];
}

function topDirection() {
    return [0, -1];
}

function rightDirection() {
    return [1, 0];
}

function setCanvasElSize(node,w,h,p) {
    node.stuff.canvasEl.width = w.value + 2 * p.value;
    node.stuff.canvasEl.height = h.value + 2 * p.value;
}

/**
 * registering an extension gives the possibility to tap into lifecycle methods
 * here is the sequence from the docs:

 * -- Web page load --
 * invokeExtensionsAsync init
 * invokeExtensionsAsync addCustomNodeDefs
 * invokeExtensionsAsync getCustomWidgets
 * invokeExtensionsAsync beforeRegisterNodeDef    [repeated multiple times]
 * invokeExtensionsAsync registerCustomNodes
 * invokeExtensionsAsync beforeConfigureGraph
 * invokeExtensionsAsync nodeCreated
 * invokeExtensions      loadedGraphNode
 * invokeExtensionsAsync afterConfigureGraph
 * invokeExtensionsAsync setup
 *
 * -- Loading workflow --
 * invokeExtensionsAsync beforeConfigureGraph
 * invokeExtensionsAsync beforeRegisterNodeDef   [zero, one, or multiple times]
 * invokeExtensionsAsync nodeCreated             [repeated multiple times]
 * invokeExtensions      loadedGraphNode         [repeated multiple times]
 * invokeExtensionsAsync afterConfigureGraph
 *
 * -- Adding new node --
 * invokeExtensionsAsync nodeCreated
 *
 *
 * more info about what the hell a node is etc
 * https://docs.comfy.org/essentials/javascript_objects_and_hijacking
 */
app.registerExtension({
    name: "Comfy.Compositor",

    async getCustomWidgets(app) {
        return {
            COMPOSITOR(node, inputName, inputData, app) {
                let {
                    CANVAS_BORDER_COLOR,
                    COMPOSITION_BORDER_COLOR,
                    COMPOSITION_BORDER_SIZE,
                    COMPOSITION_BACKGROUND_COLOR
                } = getCompositorSettings(app);

                const compositorId = getRandomCompositorUniqueId();

                initStuff(node,
                    compositorId,
                    CANVAS_BORDER_COLOR,
                    COMPOSITION_BORDER_COLOR,
                    COMPOSITION_BORDER_SIZE,
                    COMPOSITION_BACKGROUND_COLOR);

                node[COMPOSITOR] = new Promise((resolve) => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==");

                const container = createCompositorContainerDiv(node);
                node.stuff.container = container;

                const canvas = createCanvasElement(node);
                node.stuff.canvasEl = canvas;
                container.appendChild(canvas);

                /**
                 * NOTE: hideOnZoom:false FIXES not being able to take screenshot and disappearing on zoom out
                 * but creates some inconsistencies as lines get too small to be rendered properly
                 */
                return {widget: node.addDOMWidget(inputName, "COMPOSITOR", container, {hideOnZoom: false})};
            },
        };
    },
    /**
     * Called at the end of the startup process.
     * A good place to add event listeners (either for Comfy events, or DOM events), or adding to the global menus,
     * at this point we get a nodeId from a message (if we pass it) but have no node context, so we need to find it.
     *
     * Capture UI events
     * This works just like you’d expect - find the UI element in the DOM and add an eventListener.
     * setup() is a good place to do this, since the page has fully loaded.
     * For instance, to detect a click on the ‘Queue’ button:
     * ```
     *      function queue_button_pressed() { console.log("Queue button was pressed!") }
     *      document.getElementById("queue-button").addEventListener("click", queue_button_pressed);
     * ```
     */
    async setup(app) {
        // debugger;
        // disabled, for now, rely on defaults
        // addCompositorSettings.call(this, app);
``
        function addOrReplace(theImage, index, nodeId) {

            const node = app.graph.getNodeById(nodeId);

            if (stuffHasImageAtIndex(node, index)) {
                replaceImageInStuff(node, index, theImage);
            }else{
                addImageToStuff(node, index, theImage);
            }

            // whatever it happens, ensure the composition border is on top
            node.stuff.canvas.bringToFront(node.stuff.compositionBorder)
        }

        /**
         * once the node processes in python, we finally know from the event
         * what are the connected images
         * they are passed as base64 encoded or null if not connected
         * and the unique name id of the node.
         * @param event
         *
         */
        function imageMessageHandler(event) {
            // const nodeId = event.detail.node;
            // // as base64 or null, always at same index
            // const images = [...event.detail.names];
            //
            // images.map((b64, index) => {
            //     function fromUrlCallback(oImg) {
            //         addOrReplace(oImg, index, nodeId);
            //     }
            //
            //     /**
            //      * fabric.Image.fromURL
            //      * http://fabricjs.com/docs/fabric.Image.html
            //      */
            //     fabric.Image.fromURL(b64, fromUrlCallback);
            //     // stuff.canvas.renderAll();
            // });
        }

        function hook(nodeId){
            return app.graph.getNodeById(nodeId);
        }

        /**
         * when the CompositorConfig gets executed, it sends a config event
         * @param event
         */
        function configMessageHandler(event) {
            // Litegraph docs
            // https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md
            // get stuff connected to this config also...careful with the gui now...


            const running = hook(app.runningNodeId);

            const controlledCompositor = running.getOutputNodes(0)[0];

            // console.log(running.id, controlledCompositor.id);
            // this variable is referenced below by closure, do not delete
            const nodeId = controlledCompositor.id;
            const node = hook(controlledCompositor.id);


            node.stuff.w.value = event.detail.width;
            node.stuff.h.value = event.detail.height;
            node.stuff.p.value = event.detail.padding;
            node.stuff.w.callback(event.detail.width,undefined,node)
            node.stuff.h.callback(event.detail.height,undefined,node)
            node.stuff.p.callback(event.detail.padding,undefined,node)

            // node.setSize([event.detail.width,event.detail.height])
            // config node id

            // as base64 or null, always at same index
            const images = [...event.detail.names];

            images.map((b64, index) => {
                function fromUrlCallback(oImg) {
                    addOrReplace(oImg, index, nodeId);
                }

                /**
                 * fabric.Image.fromURL
                 * http://fabricjs.com/docs/fabric.Image.html
                 */
                fabric.Image.fromURL(b64, fromUrlCallback);
                // stuff.canvas.renderAll();
            });

        }

        /** important messaging considerations  https://docs.comfy.org/essentials/comms_messages */
        api.addEventListener("compositor.images", imageMessageHandler);
        api.addEventListener("compositor.config", configMessageHandler);

        /** example of arbitrary messages */
        // PromptServer.instance.send_sync("my.custom.message", {"node": node_id, "other_things": etc})
        /** example of built in*/
        function executingMessageHandler(event,a,b){
            console.log("executingMessageHandler",event,a,b);
        }
        api.addEventListener("executing",executingMessageHandler);


        /** when a node returns an ui element */
        function executedMessageHandler(event,a,b){
            console.log("executedMessageHandler",event,a,b);

            // Litegraph docs
            // https://github.com/jagenjo/litegraph.js/blob/master/guides/README.md
            // get stuff connected to this config also...careful with the gui now...


            //const running = hook(app.runningNodeId);

            //const controlledCompositor = running.getOutputNodes(0)[0];

            // console.log(running.id, controlledCompositor.id);
            // this variable is referenced below by closure, do not delete
            const e = event.detail.output;
            const nodeId = event.detail.node;
            const node = hook(nodeId);


            node.stuff.w.value = e.width[0];
            node.stuff.h.value = e.height[0];
            node.stuff.p.value = e.padding[0];
            node.stuff.w.callback(e.width[0],undefined,node)
            node.stuff.h.callback(e.height[0],undefined,node)
            node.stuff.p.callback(e.padding[0],undefined,node)

            // node.setSize([event.detail.width,event.detail.height])
            // config node id

            // as base64 or null, always at same index
            const images = [...e.names];

            images.map((b64, index) => {
                function fromUrlCallback(oImg) {
                    addOrReplace(oImg, index, nodeId);
                }

                /**
                 * fabric.Image.fromURL
                 * http://fabricjs.com/docs/fabric.Image.html
                 */
                fabric.Image.fromURL(b64, fromUrlCallback);
                // stuff.canvas.renderAll();
            });
        }
        api.addEventListener("executed",executedMessageHandler);


    },
    /**
     * Called when the Comfy webpage is loaded (or reloaded).
     * The call is made after the graph object has been created,
     * but before any nodes are registered or created.
     * It can be used to modify core Comfy behavior by hijacking methods of the app, or of the graph
     * (a LiteGraph object).
     * This is discussed further in Comfy Objects.
     */
    async init(args) {
        // console.log("init", args)
    },
    /**
     * Called once for each node type (the list of nodes available in the AddNode menu), and is used to modify the behaviour of the node.
     *
     * async beforeRegisterNodeDef(nodeType, nodeData, app)
     * The object passed in the nodeType parameter serves as a template for all nodes that will be created of this type.
     * The modifications made to "nodeType.prototype" will apply to all nodes of this type.
     * nodeData is an encapsulation of aspects of the node defined in the Python code,
     * such as its category, inputs, and outputs.
     * app is a reference to the main Comfy app object (which you have already imported anyway!)
     ```
     async beforeRegisterNodeDef(nodeType, nodeData, app) {

        if (nodeType.comfyClass == 'Compositor') {
            console.log("beforeRegisterNodeDef", nodeType, nodeData, app);

            const orig_nodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = async function () {
                // console.log("onNodeCreated", this);
                orig_nodeCreated?.apply(this, arguments)
                this.setSize([this.stuff.v.getWidth() + 100, this.stuff.v.getHeight() + 556])
            }

            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                // console.log("onExecuted", this, message);
                const r = onExecuted?.apply?.(this, arguments)
                return r;
            }
        }
    },
     ```
     */
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
    },
    /** loadedGraphNode, after nodeCreated
     *  ```
     if(node.type == "Compositor" && console.log("loadedGraphNode", node, app, node.stuff)){
         const ns = node.stuff;

         ns.safeArea.setHeight(ns.h.value);
         ns.safeArea.setWidth(ns.w.value);
         ns.safeArea.setLeft(ns.p.value);
         ns.safeArea.setTop(ns.p.value);

         ns.compositionBorder.setHeight(ns.h.value + ns.stuff.COMPOSITION_BORDER_SIZE*2);
         ns.compositionBorder.setWidth(ns.w.value  + ns.stuff.COMPOSITION_BORDER_SIZE*2);
         ns.compositionBorder.setLeft(ns.p.value - ns.stuff.COMPOSITION_BORDER_SIZE);
         ns.compositionBorder.setTop(ns.p.value - ns.stuff.COMPOSITION_BORDER_SIZE*2);
         ns.compositionBorder.set("strokeWidth", ns.stuff.COMPOSITION_BORDER_SIZE);
         ns.compositionBorder.set("stroke", ns.stuff.COMPOSITION_BORDER_COLOR);
         ns.compositionBorder.bringToFront()

         canvas.bringToFront(ns.compositionBorder);

         //console.log(v.getWidth(), v.getHeight(), value);
         ns.canvas.setHeight(ns.safeArea.getHeight() + (ns.p.value * 2));
         ns.canvas.setWidth(ns.safeArea.getWidth() + (ns.p.value * 2));
         ns.canvas.renderAll();
         ns.node.setSize(calculateWidgetSize(v));

         ns.capture();
         }
     ```
     */
    async loadedGraphNode(node, app) {
        console.log("loadedGraphNode");
    },
    async afterConfigureGraph(args) {
        // To do something when a workflow has loaded, use afterConfigureGraph, not setup
        console.log("afterConfigureGraph", args);
    },
    /**
     * Called when a specific instance of a node gets created
     * (right at the end of the ComfyNode() function on nodeType which serves as a constructor).
     * In this hook you can make modifications to individual instances of your node.
     *
     * node ref
     * https://docs.comfy.org/essentials/javascript_objects_and_hijacking
     */
    async nodeCreated(node) {
        if (!isCompositor(node)) return;
        // at this point we have W,H etc... with their values





        // const {composite, w, h, p, captureOnQueue} = getCompositorWidgets(node);
        const w = {value:512,callback:(value,graphCanvas, node)=>{console.log("w callback",value,graphCanvas, node)}};
        const h = {value:512, callback:(value,graphCanvas, node)=>{console.log("h callback",value,graphCanvas, node)}};
        const p = {value:100, callback:(value,graphCanvas, node)=>{console.log("p callback",value,graphCanvas, node)}};
        const captureOnQueue = {value:true,callback:(value,graphCanvas, node)=>{"capture on queue callback",console.log(value,graphCanvas, node)}};
        // const composite  = {value:undefined,callback:(value,graphCanvas, node)=>{console.log(value,graphCanvas, node)}};
        const composite = getCompositorWidget(node, "image");
        console.log("nodeCreated", node, node.type, composite)
        // setCanvasElSize(node,w,h,p);

        const fcanvas = createCanvas(node);

        fabric.util.addListener(document.body, 'keydown', function keydownHandler(options) {

            // if (options.repeat) {
            // prevents repeating the same command , eg.: keeping the shift+up pressed
            //     return;
            // }
            // console.log(options);
            var key = options.which || options.keyCode; // key detection
            if (isLeft(key)) {
                moveSelected(fcanvas, downDirection(),options.shiftKey);
            } else if (isTop(key)) {
                moveSelected(fcanvas, topDirection(),options.shiftKey);
            } else if (isRight(key)) {
                moveSelected(fcanvas, rightDirection(),options.shiftKey);
            } else if (isDown(key)) {
                moveSelected(fcanvas, [0, 1],options.shiftKey);
            }
        });




        const compositionArea = createCompositionArea(p, w, h, node);
        const compositionBorder = createCompositionBorder(p, w, h, node);


        node.stuff.compositionBorder = compositionBorder;

        fcanvas.add(compositionArea);
        fcanvas.add(compositionBorder);
        fcanvas.bringToFront(compositionBorder);


        setupWidthChangeCallback(w, fcanvas, p, compositionArea, compositionBorder);
        setupHeightChangeCallback(h, fcanvas, p, compositionArea, compositionBorder);
        setupPaddingChangeCallback(p, compositionArea, h, w, compositionBorder, fcanvas);
        setupCaptureOnQueueCallback(captureOnQueue, compositionArea, h, w, compositionBorder, fcanvas);

        /** the fabric fcanvas set to stuff.canvas */
        node.stuff.canvas = fcanvas;

        // final image to be associated to the node preview
        const img = new Image();

        // data url
        let data = null;
        const capture = () => {
            data = fcanvas.toDataURL({
                format: 'jpeg',
                quality: 0.8,
                left: p.value,
                top: p.value,
                width: w.value,
                height: h.value
            });
            img.onload = () => {
                node.imgs = [img];
                app.graph.setDirtyCanvas(true);
                requestAnimationFrame(() => {
                    node.setSizeForImage?.();
                });
            };
            img.src = data;
        };

        // grab some references in the node.
        // hopefully they are not serialized :D

        setupReferences(node, p, w, h, fcanvas, composite, img, compositionArea, compositionBorder, capture, captureOnQueue);


        const captureBtn = node.addWidget("button", "capture", "capture", capture);
        // not really sure if this is needed and for what, but the button does not bring any value (or should it...maybe the checksum ??
        captureBtn.serializeValue = () => {
            return "capture_"+Date.now();
        };


        /**
         * composite is the input node widget that's mapped to the output,
         * in practice we are pretending we gave the composite as input from the start
         * and we just let it through in python
         * that's why, on the first run, it will be empty ... because it is!
         */
        composite.serializeValue = async () => {
            // we can simply return a path, of an ideally uploaded file and be happy with it
            try {
                if (captureOnQueue.value) {
                    console.log("captureOnQueue",captureOnQueue.value)
                    capture();
                } else if (!node.imgs?.length) {
                    const err = `Composition not saved`;
                    throw new Error(err);
                }
                // remove selection if any or it would render
                fcanvas.discardActiveObject().renderAll();

                // attempt creating an image
                let blob = dataURLToBlob(data)

                // do we have anything stored ?
                if (neverRun(node)) {
                    console.log("never run");
                    // it's likely the first run, go on with the blob
                } else {
                    console.log("checking hash");
                    // check if the image stored in the node as last upload is the same as the one we are making
                    // by comparing the checksums
                    if (await hasSameHash(node, blob)) {
                        // exit early, don't re-upload if it is the same content !!!
                        return node.stuff.lastUpload;
                    }
                }
                node.stuff.cblob = blob;

                /**
                 * Upload image to temp storage,
                 * the image will be in the compositor subfolder of temp, not input
                 * then store the name last upload
                 */
                node.stuff.lastUpload = await uploadImage(blob)

                return node.stuff.lastUpload;
            } catch (e) {
                // we have nothing so...well..just pretend
                // return TEST_IMAGE_2;
                return null;
            }

        };

        node.setSize(calculateWidgetSize(fcanvas))
        capture();

    },
});



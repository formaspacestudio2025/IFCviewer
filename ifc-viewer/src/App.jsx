import React, { useEffect, useRef } from 'react'
import * as OBC from "@thatopen/components"
import * as WEBIFC from "web-ifc"

function App() {

    const containerRef = useRef(null)

    useEffect(() => {
        const components = new OBC.Components()
        const worlds = components.get(OBC.Worlds)

        const world = worlds.create()

        world.scene = new OBC.SimpleScene(components)
        world.renderer = new OBC.SimpleRenderer(components, containerRef.current)
        world.camera = new OBC.SimpleCamera(components)

        components.init()

        world.scene.setup()

        const loadIfc = async () => {
            const fragmentIfcLoader = components.get(OBC.IfcLoader)
            await fragmentIfcLoader.setup()

            fragmentIfcLoader.settings.excludedCategories.add(WEBIFC.IFCSPACE)

            fragmentIfcLoader.settings.webIfc.COORDINATE_TO_ORIGIN = true

            const file = await fetch(`${process.env.PUBLIC_URL}/ifc1.ifc`)
            const data = await file.arrayBuffer()
            const buffer = new Uint8Array(data)
            const model = await fragmentIfcLoader.load(buffer)
            model.name = "example"
            world.scene.three.add(model)
            console.log("loaded")
        }

        loadIfc()

        return () => {
            world.renderer?.dispose()
        }

    }, [])

    return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />

}

export default App
// TODO: Move this file to `src/dom/`
import * as React from "react"
import { createElement, ComponentType, CSSProperties } from "react"
import { buildSVGAttrs } from "stylefire"
import { MotionProps } from "../types"
import { buildStyleAttr } from "../utils/use-styles"
import { svgElements } from "../utils/supported-elements"
import { Gestures } from "./gestures"
import { MotionComponentConfig } from "../component"
import { Drag } from "./drag"
import { parseDomVariant } from "../../dom/parse-dom-variant"
import { MotionValuesMap } from "../utils/use-motion-values"
import { resolveCurrent } from "../../value/utils/resolve-values"
import { Auto } from "./auto"
import { isValidMotionProp } from "../utils/valid-prop"
import { getAnimationComponent } from "./animation"
import { Exit } from "./exit"

let isPropValid = (key: string) => !isValidMotionProp(key)

/**
 * Emotion and Styled Components both allow users to pass through arbitrary props to their components
 * to dynamically generate CSS. They both use the `@emotion/is-prop-valid` package to determine which
 * of these should be passed to the underlying DOM node.
 *
 * However, when styling a Motion component `styled(motion.div)`, both packages pass through *all* props
 * as it's seen as an arbitrary component rather than a DOM node. Motion only allows arbitrary props
 * passed through the `custom` prop so it doesn't *need* the payload or computational overhead of
 * `@emotion/is-prop-valid`, however to fix this problem we need to use it.
 *
 * By making it an optionalDependency we can offer this functionality only in the situations where it's
 * actually required.
 */
try {
    const emotionIsPropValid = require("@emotion/is-prop-valid").default

    isPropValid = (key: string) => {
        // Handle events explicitly as Emotion validates them all as true
        if (key.startsWith("on")) {
            return !isValidMotionProp(key)
        } else {
            return emotionIsPropValid(key)
        }
    }
} catch {
    // We don't need to actually do anything here - the fallback is the existing `isPropValid`.
}

function filterValidProps(props: MotionProps) {
    const domProps = {}

    for (const key in props) {
        if (isPropValid(key)) {
            domProps[key] = props[key]
        }
    }

    return domProps
}

const buildHTMLProps = (
    values: MotionValuesMap,
    style: CSSProperties,
    isStatic?: boolean,
    isDrag?: boolean
) => {
    // The `any` isn't ideal but it is the type of createElement props argument
    const props: any = {
        style: buildStyleAttr(values, style, isStatic),
    }

    if (isDrag) {
        // Disable text selection
        props.style.userSelect = "none"

        // Disable the ghost element when a user drags
        props.draggable = false
    }

    return props
}

const buildSVGProps = (values: MotionValuesMap, style: CSSProperties) => {
    const motionValueStyles = resolveCurrent(values)
    const props = buildSVGAttrs(
        motionValueStyles,
        undefined,
        undefined,
        undefined,
        undefined,
        false
    )
    props.style = { ...style, ...props.style } as any
    return props
}

const defaultFeatures = [Auto, Drag, Gestures, Exit]

/**
 * Create a configuration for `motion` components that provides DOM-specific feature.
 *
 * @internal
 */
export function createDomMotionConfig<P = MotionProps>(
    ComponentToRender: string | ComponentType<P>
): MotionComponentConfig {
    const isDOM = typeof ComponentToRender === "string"
    const isSVG = isDOM && svgElements.indexOf(ComponentToRender as any) !== -1

    return {
        renderComponent: (
            nativeElement,
            style,
            values,
            props: MotionProps,
            isStatic
        ) => {
            const forwardedProps = isDOM ? filterValidProps(props) : props

            const staticVisualStyles = isSVG
                ? buildSVGProps(values, style)
                : buildHTMLProps(values, style, isStatic, !!props.drag)

            return createElement<any>(ComponentToRender, {
                ...forwardedProps,
                ref: nativeElement.ref,
                ...staticVisualStyles,
            })
        },

        /**
         * loadFeatures gets used by the `motion` component
         *
         * Each feature component gets provided the `ref`, animation controls and the `MotionValuesMap`
         * generated for that component, as well as all the `props` passed to it by the user.
         *
         * The pattern used to determine whether to load and use each piece of feature is
         * consistent (should render? Then push component) and could be used to extend feature.
         *
         * By exposing a mutable piece of memory via an API like `extendMotionComponent` we could
         * allow users to add `MotionFeature`s. This would allow us to offer file size
         * reductions by shipping an entry point that doesn't load gesture and drag functionality, and
         * also offer a way for users to develop plugins/other feature. Because these functionalities
         * are loaded as components, we can look into using Suspense for this purpose.
         *
         * For user-defined feature we'd need to allow
         *  1) User-defined prop typing (extending `P`)
         *  2) User-defined "clean props" function that removes their plugin's props before being passed to the DOM.
         */
        loadFeatures: (
            nativeElement,
            values,
            props,
            context,
            parentContext,
            controls,
            inherit,
            plugins
        ) => {
            const allFeatures = [...defaultFeatures, ...plugins.features]
            const numFeatures = allFeatures.length
            const activeComponents: JSX.Element[] = []

            // TODO: Consolidate Animation feature loading strategy with other functionality components
            const Animation = getAnimationComponent(props)

            if (Animation) {
                activeComponents.push(
                    <Animation
                        key="animation"
                        initial={props.initial}
                        animate={props.animate}
                        variants={props.variants}
                        transition={props.transition}
                        controls={controls}
                        inherit={inherit}
                        values={values}
                    />
                )
            }

            for (let i = 0; i < numFeatures; i++) {
                const { shouldRender, key, Component } = allFeatures[i]

                if (shouldRender(props, parentContext)) {
                    activeComponents.push(
                        <Component
                            key={key}
                            {...props}
                            localContext={context}
                            parentContext={parentContext}
                            values={values}
                            controls={controls}
                            nativeElement={nativeElement}
                        />
                    )
                }
            }

            return activeComponents
        },
        getValueControlsConfig(nativeElement, values) {
            return {
                values,
                readValueFromSource: key => nativeElement.getStyle(key),
                // TODO: This is a good second source of plugins. This function contains the CSS variable
                // and unit conversion support. These functions share a common signature. We could make another
                // API for adding these.
                makeTargetAnimatable: parseDomVariant(values, nativeElement),
            }
        },
    }
}
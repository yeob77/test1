// viewportFix.js
export function createViewport(canvas, ctx, options = {}) {
    let scale = options.initialScale || 1;
    let panX = options.initialPanX || 0;
    let panY = options.initialPanY || 0;

    function applyTransform() {
        ctx.translate(panX, panY);
        ctx.scale(scale, scale);
    }

    function resetTransform() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function setZoom(newScale, anchorX, anchorY) {
        const oldScale = scale;
        scale = Math.max(0.2, Math.min(newScale, 10)); // Clamp scale

        // Adjust pan to keep anchor point fixed
        const clientRect = canvas.getBoundingClientRect();
        const dpr = canvas.width / clientRect.width;

        const mouseX = (anchorX - clientRect.left);
        const mouseY = (anchorY - clientRect.top);

        const logicalX = (mouseX - panX) / oldScale;
        const logicalY = (mouseY - panY) / oldScale;

        panX = mouseX - logicalX * scale;
        panY = mouseY - logicalY * scale;
    }

    function setPan(newPanX, newPanY) {
        panX = newPanX;
        panY = newPanY;
    }

    function toSceneFromEvent(e) {
        const clientRect = canvas.getBoundingClientRect();
        const dpr = canvas.width / clientRect.width;

        const screenX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const screenY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        const cssX = screenX - clientRect.left;
        const cssY = screenY - clientRect.top;

        const sceneX = (cssX - panX) / scale * dpr;
        const sceneY = (cssY - panY) / scale * dpr;

        return { x: sceneX, y: sceneY };
    }

    function resizeToCss() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const box = canvas.parentElement.getBoundingClientRect();
        const cssW = box.width;
        const cssH = box.height;
        
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);

        // When resizing, re-center the view if it was previously centered
        // Or adjust pan to keep current view visible
        // For simplicity, let's reset pan and scale to 1 for now, and then re-apply if needed
        // Or, more robustly, adjust pan based on the new canvas dimensions and old pan/scale
        // For now, we'll just ensure the transform is applied after resize
        applyTransform(); // Apply current transform after resize
    }

    function getState() {
        return { scale, panX, panY };
    }

    return {
        applyTransform,
        resetTransform,
        setZoom,
        setPan,
        toSceneFromEvent,
        resizeToCss,
        getState
    };
}
import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore, useSlidesStore, useKeyboardStore } from '@/store'
import type { PPTElement } from '@/types/slides'
import type { AlignmentLineProps } from '@/types/edit'
import { createElementIdMap, getRectRotatedRange, uniqAlignLines, type AlignLine } from '@/utils/element'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'

export default (
  elementList: Ref<PPTElement[]>,
  alignmentLines: Ref<AlignmentLineProps[]>,
  canvasScale: Ref<number>,
) => {
  const mainStore = useMainStore()
  const slidesStore = useSlidesStore()
  const { activeElementIdList, activeGroupElementId } = storeToRefs(mainStore)
  const { ctrlKeyState, shiftKeyState } = storeToRefs(useKeyboardStore())
  const { viewportRatio, viewportSize } = storeToRefs(slidesStore)

  const { addHistorySnapshot } = useHistorySnapshot()

  const dragElement = (e: MouseEvent | TouchEvent, element: PPTElement) => {
    const isTouchEvent = !(e instanceof MouseEvent)
    if (isTouchEvent && (!e.changedTouches || !e.changedTouches[0])) return

    if (!activeElementIdList.value.includes(element.id)) return
    let isMouseDown = true

    const edgeWidth = viewportSize.value
    const edgeHeight = viewportSize.value * viewportRatio.value
    
    const sorptionRange = 5

    const originElementList: PPTElement[] = JSON.parse(JSON.stringify(elementList.value))
    let originActiveElementList = originElementList.filter(el => activeElementIdList.value.includes(el.id))

    // Drag target element and initial property declarations; when Ctrl+drag copies, these are replaced with the duplicated element and its properties
    let dragTargetElement = element
    let elOriginLeft = element.left
    let elOriginTop = element.top
    let elOriginWidth = element.width
    let elOriginHeight = ('height' in element && element.height) ? element.height : 0
    let elOriginRotate = ('rotate' in element && element.rotate) ? element.rotate : 0
  
    const startPageX = isTouchEvent ? e.changedTouches[0].pageX : e.pageX
    const startPageY = isTouchEvent ? e.changedTouches[0].pageY : e.pageY

    let isMisoperation: boolean | null = null
    let duplicateTriggered = false // Marks whether Ctrl+drag copy has already been triggered

    const isActiveGroupElement = element.id === activeGroupElementId.value

    // Single-element dragging: only one element is selected, or an activated member within a group is being operated
    const dragSingleElement = activeElementIdList.value.length === 1 || isActiveGroupElement

    // Collect alignment snapping lines
    // This includes all the snappable alignment positions in the canvas of other elements on the page except the target element: top, bottom, left and right edges, horizontal center, vertical center
    // Lines and rotated elements need to recompute the range of their center point positions in the canvas
    let horizontalLines: AlignLine[] = []
    let verticalLines: AlignLine[] = []

    for (const el of elementList.value) {
      if (el.type === 'line') continue
      if (isActiveGroupElement && el.id === element.id) continue
      if (!isActiveGroupElement && activeElementIdList.value.includes(el.id)) continue

      let left, top, width, height
      if ('rotate' in el && el.rotate) {
        const { xRange, yRange } = getRectRotatedRange({
          left: el.left,
          top: el.top,
          width: el.width,
          height: el.height,
          rotate: el.rotate,
        })
        left = xRange[0]
        top = yRange[0]
        width = xRange[1] - xRange[0]
        height = yRange[1] - yRange[0]
      }
      else {
        left = el.left
        top = el.top
        width = el.width
        height = el.height
      }
      
      const right = left + width
      const bottom = top + height
      const centerX = top + height / 2
      const centerY = left + width / 2

      const topLine: AlignLine = { value: top, range: [left, right] }
      const bottomLine: AlignLine = { value: bottom, range: [left, right] }
      const horizontalCenterLine: AlignLine = { value: centerX, range: [left, right] }
      const leftLine: AlignLine = { value: left, range: [top, bottom] }
      const rightLine: AlignLine = { value: right, range: [top, bottom] }
      const verticalCenterLine: AlignLine = { value: centerY, range: [top, bottom] }

      horizontalLines.push(topLine, bottomLine, horizontalCenterLine)
      verticalLines.push(leftLine, rightLine, verticalCenterLine)
    }

    // The four boundaries of the canvas visible area, horizontal center, vertical center
    const edgeTopLine: AlignLine = { value: 0, range: [0, edgeWidth] }
    const edgeBottomLine: AlignLine = { value: edgeHeight, range: [0, edgeWidth] }
    const edgeHorizontalCenterLine: AlignLine = { value: edgeHeight / 2, range: [0, edgeWidth] }
    const edgeLeftLine: AlignLine = { value: 0, range: [0, edgeHeight] }
    const edgeRightLine: AlignLine = { value: edgeWidth, range: [0, edgeHeight] }
    const edgeVerticalCenterLine: AlignLine = { value: edgeWidth / 2, range: [0, edgeHeight] }

    horizontalLines.push(edgeTopLine, edgeBottomLine, edgeHorizontalCenterLine)
    verticalLines.push(edgeLeftLine, edgeRightLine, edgeVerticalCenterLine)
    
    // Deduplicate alignment snapping lines
    horizontalLines = uniqAlignLines(horizontalLines)
    verticalLines = uniqAlignLines(verticalLines)

    // Ctrl+drag copy: copy the selected elements and insert the duplicates into the canvas,
    // then switch the drag target to the duplicate element; subsequent move operations act on the duplicate
    const duplicateElement = () => {
      // Copy the source element(s); for single selection only the target element is copied, for multi-selection all selected elements are copied
      const sourceElements = JSON.parse(JSON.stringify(dragSingleElement ? [dragTargetElement] : originActiveElementList)) as PPTElement[]

      const { groupIdMap, elIdMap } = createElementIdMap(sourceElements)

      const duplicatedElements = sourceElements.map(item => {
        item.id = elIdMap[item.id]
        if (isActiveGroupElement && item.groupId) delete item.groupId
        else if (item.groupId) item.groupId = groupIdMap[item.groupId]
        return item
      })

      elementList.value = [...elementList.value, ...duplicatedElements]
      slidesStore.updateSlide({ elements: elementList.value })

      // Switch the selected state to the duplicate elements
      const duplicatedActiveElementIdList = duplicatedElements.map(item => item.id)
      const duplicatedHandleElementId = elIdMap[dragTargetElement.id]
      const duplicatedHandleElement = duplicatedElements.find(item => item.id === duplicatedHandleElementId)
      if (!duplicatedHandleElement) return

      mainStore.setActiveElementIdList(duplicatedActiveElementIdList)
      mainStore.setHandleElementId(duplicatedHandleElementId)
      mainStore.setActiveGroupElementId('')

      // Replace the drag target and initial properties with the duplicates
      dragTargetElement = duplicatedHandleElement
      originActiveElementList = duplicatedElements

      elOriginLeft = duplicatedHandleElement.left
      elOriginTop = duplicatedHandleElement.top
      elOriginWidth = duplicatedHandleElement.width
      elOriginHeight = ('height' in duplicatedHandleElement && duplicatedHandleElement.height) ? duplicatedHandleElement.height : 0
      elOriginRotate = ('rotate' in duplicatedHandleElement && duplicatedHandleElement.rotate) ? duplicatedHandleElement.rotate : 0

      duplicateTriggered = true
    }

    const handleMousemove = (e: MouseEvent | TouchEvent) => {
      const currentPageX = e instanceof MouseEvent ? e.pageX : e.changedTouches[0].pageX
      const currentPageY = e instanceof MouseEvent ? e.pageY : e.changedTouches[0].pageY

      // If the mouse sliding distance is too small, the operation is judged as a misoperation:
      // If the misoperation flag is null, this is the first move trigger, so we need to calculate whether it is currently a misoperation
      // If the misoperation flag is true, it means we are still within the misoperation range, but we still need to continue checking whether subsequent operations remain a misoperation
      // If the misoperation flag is false, it means we have moved out of the misoperation range and no longer need to calculate again
      if (isMisoperation !== false) {
        isMisoperation = Math.abs(startPageX - currentPageX) < sorptionRange && 
                         Math.abs(startPageY - currentPageY) < sorptionRange
      }
      if (!isMouseDown || isMisoperation) return

      // During dragging, if the Ctrl key is held down and no copy has been triggered yet, trigger the copy
      if (!duplicateTriggered && ctrlKeyState.value) duplicateElement()
      
      let moveX = (currentPageX - startPageX) / canvasScale.value
      let moveY = (currentPageY - startPageY) / canvasScale.value

      if (shiftKeyState.value) {
        if (Math.abs(moveX) > Math.abs(moveY)) moveY = 0
        if (Math.abs(moveX) < Math.abs(moveY)) moveX = 0
      }

      // Base target position
      let targetLeft = elOriginLeft + moveX
      let targetTop = elOriginTop + moveY

      // Calculate the target element's position range in the canvas for snap alignment
      // Need to distinguish between single-select and multi-select cases; in multi-select state, the overall range of multi-selected elements needs to be computed; in single-select state, we further distinguish three cases: lines, normal elements, and rotated normal elements
      let targetMinX: number, targetMaxX: number, targetMinY: number, targetMaxY: number

      if (dragSingleElement) {
        if (elOriginRotate) {
          const { xRange, yRange } = getRectRotatedRange({
            left: targetLeft,
            top: targetTop,
            width: elOriginWidth,
            height: elOriginHeight,
            rotate: elOriginRotate,
          })
          targetMinX = xRange[0]
          targetMaxX = xRange[1]
          targetMinY = yRange[0]
          targetMaxY = yRange[1]
        }
        else if (dragTargetElement.type === 'line') {
          targetMinX = targetLeft
          targetMaxX = targetLeft + Math.max(dragTargetElement.start[0], dragTargetElement.end[0])
          targetMinY = targetTop
          targetMaxY = targetTop + Math.max(dragTargetElement.start[1], dragTargetElement.end[1])
        }
        else {
          targetMinX = targetLeft
          targetMaxX = targetLeft + elOriginWidth
          targetMinY = targetTop
          targetMaxY = targetTop + elOriginHeight
        }
      }
      else {
        const leftValues = []
        const topValues = []
        const rightValues = []
        const bottomValues = []
        
        for (let i = 0; i < originActiveElementList.length; i++) {
          const element = originActiveElementList[i]
          const left = element.left + moveX
          const top = element.top + moveY
          const width = element.width
          const height = ('height' in element && element.height) ? element.height : 0
          const rotate = ('rotate' in element && element.rotate) ? element.rotate : 0

          if ('rotate' in element && element.rotate) {
            const { xRange, yRange } = getRectRotatedRange({ left, top, width, height, rotate })
            leftValues.push(xRange[0])
            topValues.push(yRange[0])
            rightValues.push(xRange[1])
            bottomValues.push(yRange[1])
          }
          else if (element.type === 'line') {
            leftValues.push(left)
            topValues.push(top)
            rightValues.push(left + Math.max(element.start[0], element.end[0]))
            bottomValues.push(top + Math.max(element.start[1], element.end[1]))
          }
          else {
            leftValues.push(left)
            topValues.push(top)
            rightValues.push(left + width)
            bottomValues.push(top + height)
          }
        }

        targetMinX = Math.min(...leftValues)
        targetMaxX = Math.max(...rightValues)
        targetMinY = Math.min(...topValues)
        targetMaxY = Math.max(...bottomValues)
      }
      
      const targetCenterX = targetMinX + (targetMaxX - targetMinX) / 2
      const targetCenterY = targetMinY + (targetMaxY - targetMinY) / 2

      // Compare the collected alignment snapping lines with the computed target element position range; when the difference is less than the set value, perform automatic alignment correction
      // Horizontal and vertical directions need to be calculated separately
      const _alignmentLines: AlignmentLineProps[] = []
      let isVerticalAdsorbed = false
      let isHorizontalAdsorbed = false
      for (let i = 0; i < horizontalLines.length; i++) {
        const { value, range } = horizontalLines[i]
        const min = Math.min(...range, targetMinX, targetMaxX)
        const max = Math.max(...range, targetMinX, targetMaxX)
        
        if (Math.abs(targetMinY - value) < sorptionRange && !isHorizontalAdsorbed) {
          targetTop = targetTop - (targetMinY - value)
          isHorizontalAdsorbed = true
          _alignmentLines.push({type: 'horizontal', axis: {x: min - 50, y: value}, length: max - min + 100})
        }
        if (Math.abs(targetMaxY - value) < sorptionRange && !isHorizontalAdsorbed) {
          targetTop = targetTop - (targetMaxY - value)
          isHorizontalAdsorbed = true
          _alignmentLines.push({type: 'horizontal', axis: {x: min - 50, y: value}, length: max - min + 100})
        }
        if (Math.abs(targetCenterY - value) < sorptionRange && !isHorizontalAdsorbed) {
          targetTop = targetTop - (targetCenterY - value)
          isHorizontalAdsorbed = true
          _alignmentLines.push({type: 'horizontal', axis: {x: min - 50, y: value}, length: max - min + 100})
        }
      }
      for (let i = 0; i < verticalLines.length; i++) {
        const { value, range } = verticalLines[i]
        const min = Math.min(...range, targetMinY, targetMaxY)
        const max = Math.max(...range, targetMinY, targetMaxY)

        if (Math.abs(targetMinX - value) < sorptionRange && !isVerticalAdsorbed) {
          targetLeft = targetLeft - (targetMinX - value)
          isVerticalAdsorbed = true
          _alignmentLines.push({type: 'vertical', axis: {x: value, y: min - 50}, length: max - min + 100})
        }
        if (Math.abs(targetMaxX - value) < sorptionRange && !isVerticalAdsorbed) {
          targetLeft = targetLeft - (targetMaxX - value)
          isVerticalAdsorbed = true
          _alignmentLines.push({type: 'vertical', axis: {x: value, y: min - 50}, length: max - min + 100})
        }
        if (Math.abs(targetCenterX - value) < sorptionRange && !isVerticalAdsorbed) {
          targetLeft = targetLeft - (targetCenterX - value)
          isVerticalAdsorbed = true
          _alignmentLines.push({type: 'vertical', axis: {x: value, y: min - 50}, length: max - min + 100})
        }
      }
      alignmentLines.value = _alignmentLines
      
      // In single-select state, or when the currently operated element exists among the multiple selected elements, only modify the position of the currently operated element
      if (dragSingleElement) {
        elementList.value = elementList.value.map(el => {
          return el.id === dragTargetElement.id ? { ...el, left: targetLeft, top: targetTop } : el
        })
      }

      // In multi-select state, besides modifying the position of the currently operated element, the other selected elements also need to have their positions updated
      // The positions of other selected elements are computed based on the move offset of the currently operated element
      else {
        const handleElement = elementList.value.find(el => el.id === dragTargetElement.id)
        if (!handleElement) return

        elementList.value = elementList.value.map(el => {
          if (activeElementIdList.value.includes(el.id)) {
            if (el.id === dragTargetElement.id) {
              return {
                ...el,
                left: targetLeft,
                top: targetTop,
              }
            }
            return {
              ...el,
              left: el.left + (targetLeft - handleElement.left),
              top: el.top + (targetTop - handleElement.top),
            }
          }
          return el
        })
      }
    }

    const handleMouseup = (e: MouseEvent | TouchEvent) => {
      isMouseDown = false
      
      document.ontouchmove = null
      document.ontouchend = null
      document.onmousemove = null
      document.onmouseup = null

      alignmentLines.value = []

      const currentPageX = e instanceof MouseEvent ? e.pageX : e.changedTouches[0].pageX
      const currentPageY = e instanceof MouseEvent ? e.pageY : e.changedTouches[0].pageY

      if (startPageX === currentPageX && startPageY === currentPageY) return

      slidesStore.updateSlide({ elements: elementList.value })
      addHistorySnapshot()
    }

    if (isTouchEvent) {
      document.ontouchmove = handleMousemove
      document.ontouchend = handleMouseup
    }
    else {
      document.onmousemove = handleMousemove
      document.onmouseup = handleMouseup
    }
  }

  return {
    dragElement,
  }
}
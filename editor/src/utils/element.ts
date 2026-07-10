import tinycolor from 'tinycolor2'
import { nanoid } from 'nanoid'
import type { LinePoint, PPTElement, PPTLineElement, Slide } from '@/types/slides'

interface RotatedElementData {
  left: number
  top: number
  width: number
  height: number
  rotate: number
}

interface Point {
  x: number
  y: number
}

interface AbsoluteLinePoints {
  start: Point
  end: Point
  broken?: Point
  broken2?: Point
  curve?: Point
  cubic?: [Point, Point]
}

interface IdMap {
  [id: string]: string
}

/**
 * Calculate the new position range of an element's rectangular area after rotation on the canvas
 * @param element the element's position, size and rotation angle information
 */
export const getRectRotatedRange = (element: RotatedElementData) => {
  const { left, top, width, height, rotate = 0 } = element

  const radius = Math.sqrt( Math.pow(width, 2) + Math.pow(height, 2) ) / 2
  const auxiliaryAngle = Math.atan(height / width) * 180 / Math.PI

  const tlbraRadian = (180 - rotate - auxiliaryAngle) * Math.PI / 180
  const trblaRadian = (auxiliaryAngle - rotate) * Math.PI / 180

  const middleLeft = left + width / 2
  const middleTop = top + height / 2

  const xAxis = [
    middleLeft + radius * Math.cos(tlbraRadian),
    middleLeft + radius * Math.cos(trblaRadian),
    middleLeft - radius * Math.cos(tlbraRadian),
    middleLeft - radius * Math.cos(trblaRadian),
  ]
  const yAxis = [
    middleTop - radius * Math.sin(tlbraRadian),
    middleTop - radius * Math.sin(trblaRadian),
    middleTop + radius * Math.sin(tlbraRadian),
    middleTop + radius * Math.sin(trblaRadian),
  ]

  return {
    xRange: [Math.min(...xAxis), Math.max(...xAxis)],
    yRange: [Math.min(...yAxis), Math.max(...yAxis)],
  }
}

/**
 * Calculate the offset distance between the element's new position after rotation and its original position before rotation on the canvas
 * @param element the element's position, size and rotation angle information
 */
export const getRectRotatedOffset = (element: RotatedElementData) => {
  const { xRange: originXRange, yRange: originYRange } = getRectRotatedRange({
    left: element.left,
    top: element.top,
    width: element.width,
    height: element.height,
    rotate: 0,
  })
  const { xRange: rotatedXRange, yRange: rotatedYRange } = getRectRotatedRange({
    left: element.left,
    top: element.top,
    width: element.width,
    height: element.height,
    rotate: element.rotate,
  })
  return {
    offsetX: rotatedXRange[0] - originXRange[0],
    offsetY: rotatedYRange[0] - originYRange[0],
  }
}

/**
 * Calculate the position range of an element on the canvas
 * @param element element information
 */
export const getElementRange = (element: PPTElement) => {
  let minX, maxX, minY, maxY

  if (element.type === 'line') {
    minX = element.left
    maxX = element.left + Math.max(element.start[0], element.end[0])
    minY = element.top
    maxY = element.top + Math.max(element.start[1], element.end[1])
  }
  else if ('rotate' in element && element.rotate) {
    const { left, top, width, height, rotate } = element
    const { xRange, yRange } = getRectRotatedRange({ left, top, width, height, rotate })
    minX = xRange[0]
    maxX = xRange[1]
    minY = yRange[0]
    maxY = yRange[1]
  }
  else {
    minX = element.left
    maxX = element.left + element.width
    minY = element.top
    maxY = element.top + element.height
  }
  return { minX, maxX, minY, maxY }
}

/**
 * Calculate the position range of a group of elements on the canvas
 * @param elementList a list of element information
 */
export const getElementListRange = (elementList: PPTElement[]) => {
  const leftValues: number[] = []
  const topValues: number[] = []
  const rightValues: number[] = []
  const bottomValues: number[] = []

  elementList.forEach(element => {
    const { minX, maxX, minY, maxY } = getElementRange(element)
    leftValues.push(minX)
    topValues.push(minY)
    rightValues.push(maxX)
    bottomValues.push(maxY)
  })

  const minX = Math.min(...leftValues)
  const maxX = Math.max(...rightValues)
  const minY = Math.min(...topValues)
  const maxY = Math.max(...bottomValues)

  return { minX, maxX, minY, maxY }
}

const ROTATABLE_GROUP_ELEMENT_TYPES = ['text', 'image', 'shape', 'line']

/**
 * Determine whether the currently selected elements are the complete members of the same group
 * @param elements the list of selected elements
 */
export const isSingleGroupSelection = (elements: PPTElement[]) => {
  if (elements.length < 2) return false

  const groupId = elements[0].groupId
  if (!groupId) return false

  return elements.every(element => element.groupId === groupId)
}

/**
 * Determine whether the current group allows unified rotation
 * @param elements the list of group members
 */
export const canRotateGroupElements = (elements: PPTElement[]) => {
  if (!isSingleGroupSelection(elements)) return false

  return elements.every(element => {
    if (!ROTATABLE_GROUP_ELEMENT_TYPES.includes(element.type)) return false
    if (element.type === 'line' && (element.broken || element.broken2 || element.curve || element.cubic)) return false
    return true
  })
}

/**
 * Calculate the center point of the overall range of a group of elements
 * @param elements element list
 * @param rotate the rotation reference angle of the group as a whole; alignment is performed at this angle before calculating the center point
 */
export const getGroupElementCenter = (elements: PPTElement[], rotate = 0) => {
  const { minX, maxX, minY, maxY } = getElementListRangeByRotate(elements, rotate)
  const alignedCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }

  if (!rotate) return alignedCenter

  return rotatePoint(alignedCenter, { x: 0, y: 0 }, rotate)
}

/**
 * Calculate the absolute coordinates of the four vertices of a rectangular element on the canvas
 * @param element a rectangular element
 */
const getRectElementPoints = (element: Exclude<PPTElement, PPTLineElement>) => {
  const center = {
    x: element.left + element.width / 2,
    y: element.top + element.height / 2,
  }
  const points = [
    { x: center.x - element.width / 2, y: center.y - element.height / 2 },
    { x: center.x + element.width / 2, y: center.y - element.height / 2 },
    { x: center.x + element.width / 2, y: center.y + element.height / 2 },
    { x: center.x - element.width / 2, y: center.y + element.height / 2 },
  ]

  if (!element.rotate) return points

  return points.map(point => rotatePoint(point, center, element.rotate))
}

/**
 * Calculate the list of absolute coordinates used for range calculation of a line element
 * @param element a line element
 */
const getAbsoluteLinePointList = (element: PPTLineElement) => {
  const points = getAbsoluteLinePoints(element)
  return [points.start, points.end]
}

/**
 * After aligning by the specified overall rotation reference angle, calculate the range of the element list
 * @param elements element list
 * @param rotate the overall rotation reference angle of the group
 */
const getElementListRangeByRotate = (elements: PPTElement[], rotate: number) => {
  const xValues: number[] = []
  const yValues: number[] = []

  elements.forEach(element => {
    const points = element.type === 'line' ? getAbsoluteLinePointList(element) : getRectElementPoints(element)
    const rotatedPoints = rotate ? points.map(point => rotatePoint(point, { x: 0, y: 0 }, -rotate)) : points
    xValues.push(...rotatedPoints.map(point => point.x))
    yValues.push(...rotatedPoints.map(point => point.y))
  })

  return {
    minX: Math.min(...xValues),
    maxX: Math.max(...xValues),
    minY: Math.min(...yValues),
    maxY: Math.max(...yValues),
  }
}

/**
 * Normalize an angle into the [-180, 180] range
 * @param angle the original angle
 */
export const normalizeAngle = (angle: number) => {
  let result = angle
  while (result > 180) result -= 360
  while (result < -180) result += 360
  return result
}

/**
 * Calculate the coordinates of a point after rotating it around a specified center point
 * @param point the target point
 * @param center the rotation center point
 * @param angle the rotation angle
 */
export const rotatePoint = (point: Point, center: Point, angle: number): Point => {
  const radian = angle * Math.PI / 180
  const deltaX = point.x - center.x
  const deltaY = point.y - center.y

  return {
    x: center.x + deltaX * Math.cos(radian) - deltaY * Math.sin(radian),
    y: center.y + deltaX * Math.sin(radian) + deltaY * Math.cos(radian),
  }
}

/**
 * Rotate a rectangular element: achieved by rotating the element's center point and superimposing its own rotation angle
 * @param element the element
 * @param center the group rotation center point
 * @param angle the rotation angle
 */
export const rotateRectLikeElement = (element: Exclude<PPTElement, PPTLineElement>, center: Point, angle: number) => {
  const elementCenter = {
    x: element.left + element.width / 2,
    y: element.top + element.height / 2,
  }
  const nextCenter = rotatePoint(elementCenter, center, angle)

  return {
    ...element,
    left: nextCenter.x - element.width / 2,
    top: nextCenter.y - element.height / 2,
    rotate: normalizeAngle(element.rotate + angle),
  }
}

/**
 * Convert the points of a line element to absolute coordinates on the canvas
 * @param element a line element
 */
const getAbsoluteLinePoints = (element: PPTLineElement): AbsoluteLinePoints => {
  const toAbsolutePoint = (point: [number, number]) => ({
    x: element.left + point[0],
    y: element.top + point[1],
  })

  const points: AbsoluteLinePoints = {
    start: toAbsolutePoint(element.start),
    end: toAbsolutePoint(element.end),
  }

  if (element.broken) points.broken = toAbsolutePoint(element.broken)
  if (element.broken2) points.broken2 = toAbsolutePoint(element.broken2)
  if (element.curve) points.curve = toAbsolutePoint(element.curve)
  if (element.cubic) {
    points.cubic = [
      toAbsolutePoint(element.cubic[0]),
      toAbsolutePoint(element.cubic[1]),
    ]
  }

  return points
}

/**
 * Rotate all absolute points of a line element around a specified center point
 * @param points the line's absolute points
 * @param center the group rotation center point
 * @param angle the rotation angle
 */
const rotateAbsoluteLinePoints = (points: AbsoluteLinePoints, center: Point, angle: number): AbsoluteLinePoints => {
  const rotated: AbsoluteLinePoints = {
    start: rotatePoint(points.start, center, angle),
    end: rotatePoint(points.end, center, angle),
  }

  if (points.broken) rotated.broken = rotatePoint(points.broken, center, angle)
  if (points.broken2) rotated.broken2 = rotatePoint(points.broken2, center, angle)
  if (points.curve) rotated.curve = rotatePoint(points.curve, center, angle)
  if (points.cubic) {
    rotated.cubic = [
      rotatePoint(points.cubic[0], center, angle),
      rotatePoint(points.cubic[1], center, angle),
    ]
  }

  return rotated
}

/**
 * Rebuild a line element based on the rotated absolute points
 * @param element the original line element
 * @param points the rotated absolute points
 */
const rebuildLineElement = (element: PPTLineElement, points: AbsoluteLinePoints): PPTLineElement => {
  const allPoints = [points.start, points.end]
  if (points.broken) allPoints.push(points.broken)
  if (points.broken2) allPoints.push(points.broken2)
  if (points.curve) allPoints.push(points.curve)
  if (points.cubic) allPoints.push(...points.cubic)

  const left = Math.min(...allPoints.map(point => point.x))
  const top = Math.min(...allPoints.map(point => point.y))
  const toRelativePoint = (point: Point): [number, number] => [point.x - left, point.y - top]

  const nextElement: PPTLineElement = {
    ...element,
    left,
    top,
    start: toRelativePoint(points.start),
    end: toRelativePoint(points.end),
  }

  if (points.broken) nextElement.broken = toRelativePoint(points.broken)
  else delete nextElement.broken

  if (points.broken2) nextElement.broken2 = toRelativePoint(points.broken2)
  else delete nextElement.broken2

  if (points.curve) nextElement.curve = toRelativePoint(points.curve)
  else delete nextElement.curve

  if (points.cubic) {
    nextElement.cubic = [
      toRelativePoint(points.cubic[0]),
      toRelativePoint(points.cubic[1]),
    ]
  }
  else delete nextElement.cubic

  return nextElement
}

/**
 * Rotate a line element: rebuild the line data after rotating all control points
 * @param element a line element
 * @param center the group rotation center point
 * @param angle the rotation angle
 */
export const rotateLineElement = (element: PPTLineElement, center: Point, angle: number) => {
  const absolutePoints = getAbsoluteLinePoints(element)
  const rotatedPoints = rotateAbsoluteLinePoints(absolutePoints, center, angle)
  return rebuildLineElement(element, rotatedPoints)
}

export const getLineElementLength = (element: PPTLineElement) => {
  const deltaX = element.end[0] - element.start[0]
  const deltaY = element.end[1] - element.start[1]
  const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  return len
}

export const getBroken2LineDirection = (element: PPTLineElement) => {
  if (element.broken2Direction) return element.broken2Direction

  const { minX, maxX, minY, maxY } = getElementRange(element)
  return maxX - minX >= maxY - minY ? 'horizontal' : 'vertical'
}

export interface AlignLine {
  value: number
  range: [number, number]
}

/**
 * Deduplicate a group of alignment snap lines: only one alignment snap line is kept at the same position, and the maximum and minimum values of all alignment snap lines at that position are taken as the new range
 * @param lines a list of alignment snap line information
 */
export const uniqAlignLines = (lines: AlignLine[]) => {
  const uniqLines: AlignLine[] = []
  lines.forEach(line => {
    const index = uniqLines.findIndex(_line => _line.value === line.value)
    if (index === -1) uniqLines.push(line)
    else {
      const uniqLine = uniqLines[index]
      const rangeMin = Math.min(uniqLine.range[0], line.range[0])
      const rangeMax = Math.max(uniqLine.range[1], line.range[1])
      const range: [number, number] = [rangeMin, rangeMax]
      const _line = { value: line.value, range }
      uniqLines[index] = _line
    }
  })
  return uniqLines
}

/**
 * Based on a list of pages, generate a new ID for each page and associate it with the old ID to form a dictionary
 * Mainly used to maintain the original relationships of page IDs across the data when manipulating page elements
 * @param slides the list of pages
 */
export const createSlideIdMap = (slides: Slide[]) => {
  const slideIdMap: IdMap = {}
  for (const slide of slides) {
    slideIdMap[slide.id] = nanoid(10)
  }
  return slideIdMap
}

/**
   * Based on a list of elements, generate a new ID for each element and associate it with the old ID to form a dictionary
   * Mainly used to maintain the original relationships of element IDs across the data when copying elements
   * For example: two elements originally in the same group share the same groupId; after copying, they will still share another identical groupId
   * @param elements the element list data
   */
export const createElementIdMap = (elements: PPTElement[]) => {
  const groupIdMap: IdMap = {}
  const elIdMap: IdMap = {}
  for (const element of elements) {
    const groupId = element.groupId
    if (groupId && !groupIdMap[groupId]) {
      groupIdMap[groupId] = nanoid(10)
    }
    elIdMap[element.id] = nanoid(10)
  }
  return {
    groupIdMap,
    elIdMap,
  }
}

/**
 * Based on the table's theme color, get the sub-colors used for color matching
 * @param themeColor the theme color
 */
export const getTableSubThemeColor = (themeColor: string) => {
  const rgba = tinycolor(themeColor)
  return [
    rgba.setAlpha(0.3).toRgbString(),
    rgba.setAlpha(0.1).toRgbString(),
  ]
}

/**
 * Get the path string of a line element
 * @param element a line element
 */
export const getLineElementPath = (element: PPTLineElement) => {
  const start = element.start.join(',')
  const end = element.end.join(',')
  if (element.broken) {
    const mid = element.broken.join(',')
    return `M${start} L${mid} L${end}`
  }
  else if (element.broken2) {
    const direction = getBroken2LineDirection(element)
    if (direction === 'horizontal') return `M${start} L${element.broken2[0]},${element.start[1]} L${element.broken2[0]},${element.end[1]} ${end}`
    return `M${start} L${element.start[0]},${element.broken2[1]} L${element.end[0]},${element.broken2[1]} ${end}`
  }
  else if (element.curve) {
    const mid = element.curve.join(',')
    return `M${start} Q${mid} ${end}`
  }
  else if (element.cubic) {
    const [c1, c2] = element.cubic
    const p1 = c1.join(',')
    const p2 = c2.join(',')
    return `M${start} C${p1} ${p2} ${end}`
  }
  return `M${start} L${end}`
}

/**
 * Based on the line endpoint type and line width, calculate the distance the line body needs to retract inward during rendering
 * @param point the line endpoint type
 * @param width the line width
 */
const getLinePointRetractionOffset = (point: LinePoint, width: number) => {
  const size = width < 2 ? 2 : width
  if (point === 'arrow') return size
  if (point === 'dot') return size / 2
  return 0
}

/**
 * Calculate the distance between two line points
 * @param p1 the first point
 * @param p2 the second point
 */
const getLinePointDistance = (p1: [number, number], p2: [number, number]) => {
  const deltaX = p2[0] - p1[0]
  const deltaY = p2[1] - p1[1]
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY)
}

/**
 * Translate a line point toward the target point direction by a specified offset distance
 * @param point the current point
 * @param target the target point
 * @param offset the offset distance
 */
const getLinePointByOffset = (
  point: [number, number],
  target: [number, number],
  offset: number,
) => {
  const distance = getLinePointDistance(point, target)
  if (!distance) return point

  const ratio = offset / distance
  return [
    point[0] + (target[0] - point[0]) * ratio,
    point[1] + (target[1] - point[1]) * ratio,
  ] as [number, number]
}

/**
 * Get the adjacent control points corresponding to the start and end of a line path, used to calculate the endpoint retraction direction
 * @param element a line element
 */
const getLinePathTurningPoints = (element: PPTLineElement) => {
  if (element.broken) return [element.broken]

  if (element.broken2) {
    const direction = getBroken2LineDirection(element)
    if (direction === 'horizontal') {
      return [
        [element.broken2[0], element.start[1]],
        [element.broken2[0], element.end[1]],
      ] as [number, number][]
    }
    return [
      [element.start[0], element.broken2[1]],
      [element.end[0], element.broken2[1]],
    ] as [number, number][]
  }

  if (element.curve) return [element.curve]
  if (element.cubic) return [element.cubic[0], element.cubic[1]]
  return []
}

/**
 * Get the path string of a line element used for actual rendering:
 * keep the endpoint markers aligned with the original start/end, and only retract the visible line body inward at both ends as needed
 * @param element a line element
 */
export const getLineElementRenderPath = (element: PPTLineElement) => {
  const turningPoints = getLinePathTurningPoints(element)

  let start = element.start
  let end = element.end

  const startOffset = getLinePointRetractionOffset(element.points[0], element.width)
  const endOffset = getLinePointRetractionOffset(element.points[1], element.width)

  if (startOffset) {
    const nextPoint = turningPoints[0] || element.end
    const offset = Math.min(startOffset, getLinePointDistance(element.start, nextPoint) / 2)
    start = getLinePointByOffset(element.start, nextPoint, offset)
  }

  if (endOffset) {
    const prevPoint = turningPoints[turningPoints.length - 1] || element.start
    const offset = Math.min(endOffset, getLinePointDistance(prevPoint, element.end) / 2)
    end = getLinePointByOffset(element.end, prevPoint, offset)
  }

  const startPoint = start.join(',')
  const endPoint = end.join(',')
  if (element.broken) {
    const mid = element.broken.join(',')
    return `M${startPoint} L${mid} L${endPoint}`
  }
  else if (element.broken2) {
    const direction = getBroken2LineDirection(element)
    if (direction === 'horizontal') return `M${startPoint} L${element.broken2[0]},${element.start[1]} L${element.broken2[0]},${element.end[1]} ${endPoint}`
    return `M${startPoint} L${element.start[0]},${element.broken2[1]} L${element.end[0]},${element.broken2[1]} ${endPoint}`
  }
  else if (element.curve) {
    const mid = element.curve.join(',')
    return `M${startPoint} Q${mid} ${endPoint}`
  }
  else if (element.cubic) {
    const [c1, c2] = element.cubic
    const p1 = c1.join(',')
    const p2 = c2.join(',')
    return `M${startPoint} C${p1} ${p2} ${endPoint}`
  }
  return `M${startPoint} L${endPoint}`
}

/**
 * Determine whether an element is within the visible range
 * @param element the element
 * @param parent the parent element
 */
export const isElementInViewport = (element: HTMLElement, parent: HTMLElement): boolean => {
  const elementRect = element.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()

  return (
    elementRect.top >= parentRect.top &&
    elementRect.bottom <= parentRect.bottom
  )
}

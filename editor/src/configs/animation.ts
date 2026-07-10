import type { TurningMode } from '@/types/slides'

export const ANIMATION_DEFAULT_DURATION = 1000
export const ANIMATION_DEFAULT_TRIGGER = 'click'
export const ANIMATION_CLASS_PREFIX = 'animate__'

export const ENTER_ANIMATIONS = [
  {
    type: 'bounce',
    name: 'Bounce',
    children: [
      { name: 'Bounce In', value: 'bounceIn' },
      { name: 'Bounce In to Right', value: 'bounceInLeft' },
      { name: 'Bounce In to Left', value: 'bounceInRight' },
      { name: 'Bounce In Up', value: 'bounceInUp' },
      { name: 'Bounce In Down', value: 'bounceInDown' },
    ],
  },
  {
    type: 'fade',
    name: 'Fade',
    children: [
      { name: 'Fade In', value: 'fadeIn' },
      { name: 'Fade In Down', value: 'fadeInDown' },
      { name: 'Fade In Down Big', value: 'fadeInDownBig' },
      { name: 'Fade In to Right', value: 'fadeInLeft' },
      { name: 'Fade In to Right Big', value: 'fadeInLeftBig' },
      { name: 'Fade In to Left', value: 'fadeInRight' },
      { name: 'Fade In to Left Big', value: 'fadeInRightBig' },
      { name: 'Fade In Up', value: 'fadeInUp' },
      { name: 'Fade In Up Big', value: 'fadeInUpBig' },
      { name: 'Fade In from Top-Left', value: 'fadeInTopLeft' },
      { name: 'Fade In from Top-Right', value: 'fadeInTopRight' },
      { name: 'Fade In from Bottom-Left', value: 'fadeInBottomLeft' },
      { name: 'Fade In from Bottom-Right', value: 'fadeInBottomRight' },
    ],
  },
  {
    type: 'rotate',
    name: 'Rotate',
    children: [
      { name: 'Rotate In', value: 'rotateIn' },
      { name: 'Rotate In Down Left', value: 'rotateInDownLeft' },
      { name: 'Rotate In Down Right', value: 'rotateInDownRight' },
      { name: 'Rotate In Up Left', value: 'rotateInUpLeft' },
      { name: 'Rotate In Up Right', value: 'rotateInUpRight' },
    ],
  },
  {
    type: 'zoom',
    name: 'Zoom',
    children: [
      { name: 'Zoom In', value: 'zoomIn' },
      { name: 'Zoom In Down', value: 'zoomInDown' },
      { name: 'Zoom In from Left', value: 'zoomInLeft' },
      { name: 'Zoom In from Right', value: 'zoomInRight' },
      { name: 'Zoom In Up', value: 'zoomInUp' },
    ],
  },
  {
    type: 'slide',
    name: 'Slide In',
    children: [
      { name: 'Slide In Down', value: 'slideInDown' },
      { name: 'Slide In from Right', value: 'slideInLeft' },
      { name: 'Slide In from Left', value: 'slideInRight' },
      { name: 'Slide In Up', value: 'slideInUp' },
    ],
  },
  {
    type: 'flip',
    name: 'Flip',
    children: [
      { name: 'Flip In X', value: 'flipInX' },
      { name: 'Flip In Y', value: 'flipInY' },
    ],
  },
  {
    type: 'back',
    name: 'Zoom Slide In',
    children: [
      { name: 'Zoom Slide In Down', value: 'backInDown' },
      { name: 'Zoom Slide In from Left', value: 'backInLeft' },
      { name: 'Zoom Slide In from Right', value: 'backInRight' },
      { name: 'Zoom Slide In Up', value: 'backInUp' },
    ],
  },
  {
    type: 'lightSpeed',
    name: 'Fly In',
    children: [
      { name: 'Fly In from Right', value: 'lightSpeedInRight' },
      { name: 'Fly In from Left', value: 'lightSpeedInLeft' },
    ],
  },
]

export const EXIT_ANIMATIONS = [
  {
    type: 'bounce',
    name: 'Bounce',
    children: [
      { name: 'Bounce Out', value: 'bounceOut' },
      { name: 'Bounce Out to Left', value: 'bounceOutLeft' },
      { name: 'Bounce Out to Right', value: 'bounceOutRight' },
      { name: 'Bounce Out Up', value: 'bounceOutUp' },
      { name: 'Bounce Out Down', value: 'bounceOutDown' },
    ],
  },
  {
    type: 'fade',
    name: 'Fade',
    children: [
      { name: 'Fade Out', value: 'fadeOut' },
      { name: 'Fade Out Down', value: 'fadeOutDown' },
      { name: 'Fade Out Down Big', value: 'fadeOutDownBig' },
      { name: 'Fade Out to Left', value: 'fadeOutLeft' },
      { name: 'Fade Out to Left Big', value: 'fadeOutLeftBig' },
      { name: 'Fade Out to Right', value: 'fadeOutRight' },
      { name: 'Fade Out to Right Big', value: 'fadeOutRightBig' },
      { name: 'Fade Out Up', value: 'fadeOutUp' },
      { name: 'Fade Out Up Big', value: 'fadeOutUpBig' },
      { name: 'Fade Out from Top-Left', value: 'fadeOutTopLeft' },
      { name: 'Fade Out from Top-Right', value: 'fadeOutTopRight' },
      { name: 'Fade Out from Bottom-Left', value: 'fadeOutBottomLeft' },
      { name: 'Fade Out from Bottom-Right', value: 'fadeOutBottomRight' },
    ],
  },
  {
    type: 'rotate',
    name: 'Rotate',
    children: [
      { name: 'Rotate Out', value: 'rotateOut' },
      { name: 'Rotate Out Down Left', value: 'rotateOutDownLeft' },
      { name: 'Rotate Out Down Right', value: 'rotateOutDownRight' },
      { name: 'Rotate Out Up Left', value: 'rotateOutUpLeft' },
      { name: 'Rotate Out Up Right', value: 'rotateOutUpRight' },
    ],
  },
  {
    type: 'zoom',
    name: 'Zoom',
    children: [
      { name: 'Zoom Out', value: 'zoomOut' },
      { name: 'Zoom Out Down', value: 'zoomOutDown' },
      { name: 'Zoom Out from Left', value: 'zoomOutLeft' },
      { name: 'Zoom Out from Right', value: 'zoomOutRight' },
      { name: 'Zoom Out Up', value: 'zoomOutUp' },
    ],
  },
  {
    type: 'slide',
    name: 'Slide Out',
    children: [
      { name: 'Slide Out Down', value: 'slideOutDown' },
      { name: 'Slide Out from Left', value: 'slideOutLeft' },
      { name: 'Slide Out from Right', value: 'slideOutRight' },
      { name: 'Slide Out Up', value: 'slideOutUp' },
    ],
  },
  {
    type: 'flip',
    name: 'Flip',
    children: [
      { name: 'Flip Out X', value: 'flipOutX' },
      { name: 'Flip Out Y', value: 'flipOutY' },
    ],
  },
  {
    type: 'back',
    name: 'Shrink Slide Out',
    children: [
      { name: 'Shrink Slide Out Down', value: 'backOutDown' },
      { name: 'Shrink Slide Out from Left', value: 'backOutLeft' },
      { name: 'Shrink Slide Out from Right', value: 'backOutRight' },
      { name: 'Shrink Slide Out Up', value: 'backOutUp' },
    ],
  },
  {
    type: 'lightSpeed',
    name: 'Fly Out',
    children: [
      { name: 'Fly Out from Right', value: 'lightSpeedOutRight' },
      { name: 'Fly Out from Left', value: 'lightSpeedOutLeft' },
    ],
  },
]

export const ATTENTION_ANIMATIONS = [
  {
    type: 'shake',
    name: 'Shake',
    children: [
      { name: 'Shake Horizontally', value: 'shakeX' },
      { name: 'Shake Vertically', value: 'shakeY' },
      { name: 'Head Shake', value: 'headShake' },
      { name: 'Swing', value: 'swing' },
      { name: 'Wobble', value: 'wobble' },
      { name: 'Tada', value: 'tada' },
      { name: 'Jelly', value: 'jello' },
    ],
  },
  {
    type: 'other',
    name: 'Other',
    children: [
      { name: 'Bounce', value: 'bounce' },
      { name: 'Flash', value: 'flash' },
      { name: 'Pulse', value: 'pulse' },
      { name: 'Rubber Band', value: 'rubberBand' },
      { name: 'Heartbeat (Fast)', value: 'heartBeat' },
    ],
  },
]

interface SlideAnimation {
  label: string
  value: TurningMode
}

export const SLIDE_ANIMATIONS: SlideAnimation[] = [
  { label: 'None', value: 'no' },
  { label: 'Random', value: 'random' },
  { label: 'Slide Left-Right', value: 'slideX' },
  { label: 'Slide Up-Down', value: 'slideY' },
  { label: 'Slide Left-Right (3D)', value: 'slideX3D' },
  { label: 'Slide Up-Down (3D)', value: 'slideY3D' },
  { label: 'Fade In and Out', value: 'fade' },
  { label: 'Rotate', value: 'rotate' },
  { label: 'Expand Up-Down', value: 'scaleY' },
  { label: 'Expand Left-Right', value: 'scaleX' },
  { label: 'Zoom In', value: 'scale' },
  { label: 'Zoom Out', value: 'scaleReverse' },
]
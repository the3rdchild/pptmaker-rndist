import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
	{
		variants: {
			variant: {
				primary: 'bg-[#6c5ce7] text-white hover:bg-[#5b4ed1]',
				ghost: 'text-zinc-400 hover:bg-[#2d2e42] hover:text-zinc-200',
				outline: 'border border-[#2d2e42] text-zinc-300 hover:bg-[#2d2e42] hover:text-white',
				subtle: 'bg-[#2d2e42] text-zinc-200 hover:bg-[#3a3b52]',
			},
			size: {
				sm: 'h-8 px-3',
				md: 'h-10 px-4',
				icon: 'h-9 w-9',
			},
		},
		defaultVariants: { variant: 'primary', size: 'md' },
	},
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
	return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

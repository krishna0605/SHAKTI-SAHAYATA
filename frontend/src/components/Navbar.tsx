import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FolderPlus, LayoutDashboard, LogOut, Menu, Moon, Search, Settings, Sun } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { api } from '../lib/api'
import { BrandMark } from '@/components/shared/BrandMark'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/create-case', label: 'New Case', icon: FolderPlus },
  { to: '/osint', label: 'OSINT Tools', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Navbar() {
  const { user, isDarkMode, toggleTheme, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = async () => {
    try {
      await api.logout()
    } catch {
      // local state is still cleared below
    }
    logout()
    navigate('/login')
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/dashboard" className="interactive-ring rounded-2xl">
            <BrandMark compact />
          </Link>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to
            return (
              <Button
                key={to}
                asChild
                variant={active ? 'secondary' : 'ghost'}
                className={cn(
                  'h-10 rounded-2xl px-4',
                  active && 'border border-shakti-300/25 bg-shakti-50 text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200'
                )}
              >
                <Link to={to}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              </Button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-2xl"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-2xl md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="border-white/10 bg-surface-950 text-slate-100">
              <SheetHeader className="px-0">
                <SheetTitle className="px-4"><BrandMark compact /></SheetTitle>
                <SheetDescription className="px-4 text-slate-400">
                  Navigate the SHAKTI command workspace.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-2 px-4 pb-4 pt-2">
                {navItems.map(({ to, label, icon: Icon }) => {
                  const active = location.pathname === to
                  return (
                    <Button
                      key={to}
                      asChild
                      variant={active ? 'secondary' : 'ghost'}
                      className={cn(
                        'h-11 w-full justify-start rounded-2xl px-4',
                        active && 'border border-shakti-400/25 bg-shakti-500/10 text-shakti-200'
                      )}
                    >
                      <Link to={to}>
                        <Icon className="h-4 w-4" />
                        {label}
                      </Link>
                    </Button>
                  )
                })}
              </div>
            </SheetContent>
          </Sheet>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-12 rounded-2xl px-2 sm:px-3">
                <Avatar className="h-9 w-9 border border-shakti-300/25 bg-gradient-to-br from-blue-100 to-shakti-100 dark:from-shakti-500/10 dark:to-blue-500/10">
                  <AvatarFallback className="bg-transparent font-semibold text-shakti-700 dark:text-shakti-300">
                    {user?.fullName?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden text-left lg:block">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {user?.fullName || 'Officer'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{user?.buckleId || 'BK-0000'}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-2xl border-white/10 bg-popover/95 p-2 backdrop-blur-xl">
              <DropdownMenuLabel className="px-3 py-2">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">{user?.fullName || 'Officer'}</div>
                  <div className="text-xs text-muted-foreground">{user?.email}</div>
                  <div className="flex items-center gap-2 pt-1">
                    <Badge className="rounded-full border border-shakti-300/20 bg-shakti-50 text-shakti-700 dark:border-shakti-400/20 dark:bg-shakti-500/10 dark:text-shakti-200">
                      {user?.buckleId}
                    </Badge>
                    {user?.position ? (
                      <span className="text-xs text-muted-foreground">{user.position}</span>
                    ) : null}
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="rounded-xl px-3 py-2">
                <Link to="/settings">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="rounded-xl px-3 py-2 text-red-600 dark:text-red-400">
                <LogOut className="h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  )
}

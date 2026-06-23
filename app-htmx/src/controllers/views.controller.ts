import 'reflect-metadata';
import { Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';

// HTMX views controller. `ctx.htmx` is attached by HtmxPlugin.middleware()
// (registered in main.ts). `view()` returns the full layout on navigation and
// just the page fragment on an HTMX request.
@Controller('/')
export class ViewsController {
  private todos: { id: number; text: string }[] = [];
  private nextId = 1;

  @Get('/')
  async home(ctx: StreetContext): Promise<void> {
    const todos = this.todos.map((t) => ctx.htmx.engine.partial('todo-item', t)).join('');
    ctx.htmx.view('home', { title: 'Home', todos });
  }

  @Post('/todos')
  async addTodo(ctx: StreetContext): Promise<void> {
    const { text } = ctx.body as { text: string };
    const todo = { id: this.nextId++, text };
    this.todos.push(todo);
    ctx.htmx.hx({ trigger: 'todoAdded' }).partial('todo-item', todo); // returns just the new <li>
  }

  @Get('/dashboard')
  async dashboard(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard', { title: 'Dashboard', user: { email: 'you@example.com' } });
  }

  @Get('/login')
  async login(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('login', { title: 'Log in' });
  }

  @Get('/register')
  async register(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('register', { title: 'Create account' });
  }
}

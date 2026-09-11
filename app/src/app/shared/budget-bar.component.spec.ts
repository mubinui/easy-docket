import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BudgetBarComponent } from './budget-bar.component';

describe('BudgetBarComponent', () => {
  let fixture: ComponentFixture<BudgetBarComponent>;

  function render(share: number, over = false): HTMLElement {
    fixture.componentRef.setInput('share', share);
    fixture.componentRef.setInput('over', over);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.bar span') as HTMLElement;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [BudgetBarComponent] });
    fixture = TestBed.createComponent(BudgetBarComponent);
  });

  it('fills in proportion to the share used', () => {
    expect(render(0).style.width).toBe('0%');
    expect(render(45).style.width).toBe('45%');
    expect(render(100).style.width).toBe('100%');
  });

  it('is green within budget and red over it', () => {
    expect(render(60, false).style.background).toContain('success');
    expect(render(100, true).style.background).toContain('danger');
  });

  it('describes itself for screen readers', () => {
    render(60, false);
    const bar = fixture.nativeElement.querySelector('.bar') as HTMLElement;

    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(bar.getAttribute('aria-label')).toBe('60% of budget used');

    render(100, true);
    expect(
      (fixture.nativeElement.querySelector('.bar') as HTMLElement).getAttribute('aria-label'),
    ).toContain('Over budget');
  });
});

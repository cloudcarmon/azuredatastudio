/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/table';

import {
	Component, Input, Inject, ChangeDetectorRef, forwardRef, ViewChild, ElementRef, OnDestroy, AfterViewInit
} from '@angular/core';

import * as azdata from 'azdata';

import { ComponentBase } from 'sql/workbench/browser/modelComponents/componentBase';

import { Table } from 'sql/base/browser/ui/table/table';
import { TableDataView } from 'sql/base/browser/ui/table/tableDataView';
import { attachTableStyler, attachButtonStyler } from 'sql/platform/theme/common/styler';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { getContentHeight, getContentWidth, Dimension } from 'vs/base/browser/dom';
import { RowSelectionModel } from 'sql/base/browser/ui/table/plugins/rowSelectionModel.plugin';
import { CheckboxSelectColumn, ICheckboxCellActionEventArgs } from 'sql/base/browser/ui/table/plugins/checkboxSelectColumn.plugin';
import { Emitter, Event as vsEvent } from 'vs/base/common/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { slickGridDataItemColumnValueWithNoData, textFormatter } from 'sql/base/browser/ui/table/formatters';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { IComponent, IComponentDescriptor, IModelStore, ComponentEventType } from 'sql/platform/dashboard/browser/interfaces';
import { convertSizeToNumber } from 'sql/base/browser/dom';
import { ButtonColumn, ButtonClickEventArgs } from 'sql/base/browser/ui/table/plugins/buttonColumn.plugin';
import { createIconCssClass } from 'sql/workbench/browser/modelComponents/iconUtils';
import { HeaderFilter } from 'sql/base/browser/ui/table/plugins/headerFilter.plugin';
import { TextWithIconColumn } from 'sql/base/browser/ui/table/plugins/textWithIconColumn';

export enum ColumnSizingMode {
	ForceFit = 0,	// all columns will be sized to fit in viewable space, no horiz scroll bar
	AutoFit = 1,	// columns will be ForceFit up to a certain number; currently 3.  At 4 or more the behavior will switch to NO force fit
	DataFit = 2		// columns use sizing based on cell data, horiz scroll bar present if more cells than visible in view area
}

@Component({
	selector: 'modelview-table',
	template: `
		<div #table style="height:100%;" [style.font-size]="fontSize" [style.width]="width"></div>
	`
})
export default class TableComponent extends ComponentBase<azdata.TableComponentProperties> implements IComponent, OnDestroy, AfterViewInit {
	@Input() descriptor: IComponentDescriptor;
	@Input() modelStore: IModelStore;
	private _table: Table<Slick.SlickData>;
	private _tableData: TableDataView<Slick.SlickData>;
	private _tableColumns;
	private _checkboxColumns: CheckboxSelectColumn<{}>[] = [];
	private _buttonsColumns: ButtonColumn<{}>[] = [];
	private _pluginsRegisterStatus: boolean[] = [];
	private _filterPlugin: HeaderFilter<Slick.SlickData>;
	private _onCheckBoxChanged = new Emitter<ICheckboxCellActionEventArgs>();
	private _onButtonClicked = new Emitter<ButtonClickEventArgs<{}>>();
	public readonly onCheckBoxChanged: vsEvent<ICheckboxCellActionEventArgs> = this._onCheckBoxChanged.event;
	public readonly onButtonClicked: vsEvent<ButtonClickEventArgs<{}>> = this._onButtonClicked.event;

	@ViewChild('table', { read: ElementRef }) private _inputContainer: ElementRef;
	constructor(
		@Inject(forwardRef(() => ChangeDetectorRef)) changeRef: ChangeDetectorRef,
		@Inject(IWorkbenchThemeService) private themeService: IWorkbenchThemeService,
		@Inject(forwardRef(() => ElementRef)) el: ElementRef) {
		super(changeRef, el);
	}

	ngOnInit(): void {
		this.baseInit();

	}

	private findIconProviders(columns: azdata.TableColumn[]): Set<string> | undefined {
		if (!columns) {
			return undefined;
		}
		return new Set<string>(
			columns.map(col => {
				const textColOptions = col.options as azdata.TextColumnOption;
				if (textColOptions && textColOptions.iconCssClassColumn) {
					return textColOptions.iconCssClassColumn;
				}
				return '';
			}));
	}

	transformColumns(columns: string[] | azdata.TableColumn[]): Slick.Column<any>[] {
		let tableColumns: any[] = <any[]>columns;
		if (tableColumns) {
			let mycolumns: Slick.Column<any>[] = [];
			let index: number = 0;
			// get columns that will be used as icon providers
			const iconProviderColumns = this.findIconProviders(columns as azdata.TableColumn[]);

			(<any[]>columns).map(col => {
				if (col.type && col.type === 1) {
					this.createCheckBoxPlugin(col, index);
				}
				else if (col.type && col.type === 2) {
					this.createButtonPlugin(col);
				}
				else if (col.value) {
					if (!iconProviderColumns?.has(col.value)) {
						mycolumns.push(TableComponent.createTextColumn(col as azdata.TableColumn));
					}
				} else {
					mycolumns.push(<Slick.Column<any>>{
						name: <string>col,
						id: <string>col,
						field: <string>col,
						formatter: textFormatter
					});
				}
				index++;
			});
			return mycolumns;
		} else {
			return (<string[]>columns).map(col => {
				return <Slick.Column<any>>{
					name: col,
					id: col,
					field: col
				};
			});
		}
	}

	private static createTextColumn(col: azdata.TableColumn): Slick.Column<any> {
		if ((col.options as azdata.TextColumnOption)?.iconCssClassColumn) {
			const textWithIconColumn = new TextWithIconColumn({
				name: col.value,
				id: col.value,
				field: col.value,
				width: col.width,
				headerCssClass: col.headerCssClass,
				formatter: textFormatter,
				iconCssClassField: (<azdata.TextColumnOption>col.options).iconCssClassColumn
			});
			return textWithIconColumn.definition;
		}
		return <Slick.Column<any>>{
			name: col.value,
			id: col.value,
			field: col.value,
			width: col.width,
			cssClass: col.cssClass,
			headerCssClass: col.headerCssClass,
			toolTip: col.toolTip,
			formatter: textFormatter,
		};
	}

	public static transformData(rows: string[][], columns: any[]): { [key: string]: string }[] {
		if (rows && columns) {
			return rows.map(row => {
				let object: { [key: string]: string } = {};
				if (row.forEach) {
					row.forEach((val, index) => {
						let columnName: string = (columns[index].value) ? columns[index].value : <string>columns[index];
						object[columnName] = val;
					});
				}
				return object;
			});
		} else {
			return [];
		}
	}

	ngAfterViewInit(): void {
		if (this._inputContainer) {
			this._tableData = new TableDataView<Slick.SlickData>(
				null,
				null,
				null,
				(data: Slick.SlickData[]) => {
					let columns = this._table.grid.getColumns();

					for (let i = 0; i < columns.length; i++) {
						let col: any = columns[i];
						let filterValues: Array<any> = col.filterValues;
						if (filterValues && filterValues.length > 0) {
							return data.filter(item => {
								let colValue = item[col.field];
								if (colValue instanceof Array) {
									return filterValues.find(x => colValue.indexOf(x) >= 0);
								}
								return filterValues.find(x => x === colValue);
							});
						}
					}

					return data;
				}
			);

			let options = <Slick.GridOptions<any>>{
				syncColumnCellResize: true,
				enableColumnReorder: false,
				enableCellNavigation: true,
				forceFitColumns: true, // default to true during init, actual value will be updated when setProperties() is called
				dataItemColumnValueExtractor: slickGridDataItemColumnValueWithNoData // must change formatter if you are changing explicit column value extractor
			};

			this._table = new Table<Slick.SlickData>(this._inputContainer.nativeElement, { dataProvider: this._tableData, columns: this._tableColumns }, options);
			this._table.setData(this._tableData);
			this._table.setSelectionModel(new RowSelectionModel({ selectActiveRow: true }));

			this._register(this._table);
			this._register(attachTableStyler(this._table, this.themeService));
			this._register(this._table.onSelectedRowsChanged((e, data) => {
				this.selectedRows = data.rows;
				this.fireEvent({
					eventType: ComponentEventType.onSelectedRowChanged,
					args: e
				});
			}));

			this._table.grid.onKeyDown.subscribe((e: DOMEvent) => {
				if (this.moveFocusOutWithTab) {
					let event = new StandardKeyboardEvent(e as KeyboardEvent);
					if (event.equals(KeyMod.Shift | KeyCode.Tab)) {
						e.stopImmediatePropagation();
						(<HTMLElement>(<HTMLElement>this._inputContainer.nativeElement).previousElementSibling).focus();

					} else if (event.equals(KeyCode.Tab)) {
						e.stopImmediatePropagation();
						(<HTMLElement>(<HTMLElement>this._inputContainer.nativeElement).nextElementSibling).focus();
					}
				}
			});
		}
	}

	public validate(): Thenable<boolean> {
		return super.validate().then(valid => {
			// TODO: table validation?
			return valid;
		});
	}

	ngOnDestroy(): void {
		this.baseDestroy();
	}

	/// IComponent implementation

	public layout(): void {
		this.layoutTable();
		super.layout();
	}

	private layoutTable(): void {
		let width: number = convertSizeToNumber(this.width);
		let height: number = convertSizeToNumber(this.height);
		let forceFit: boolean = true;

		// convert the tri-state viewmodel columnSizingMode to be either true or false for SlickGrid
		switch (this.forceFitColumns) {
			case ColumnSizingMode.DataFit: {
				forceFit = false;
				break;
			}
			case ColumnSizingMode.AutoFit: {
				// determine if force fit should be on or off based on the number of columns
				// this can be made more sophisticated if need be in the future.  a simple
				// check for 3 or less force fits causes the small number of columns to fill the
				// screen better.  4 or more, slickgrid seems to do a good job filling the view and having forceFit
				// false enables the scroll bar and avoids the over-packing should there be a very large
				// number of columns
				forceFit = (this._table.columns.length <= 3);
				break;
			}
			case ColumnSizingMode.ForceFit:
			default: {
				// default behavior for the table component (used primarily in wizards) is to forcefit the columns
				forceFit = true;
				break;
			}
		}
		let updateOptions = <Slick.GridOptions<any>>{
			forceFitColumns: forceFit
		};
		this._table.setOptions(updateOptions);

		this._table.layout(new Dimension(
			width && width > 0 ? width : getContentWidth(this._inputContainer.nativeElement),
			height && height > 0 ? height : getContentHeight(this._inputContainer.nativeElement)));
		this._table.resizeCanvas();
	}

	public setLayout(): void {
		// TODO allow configuring the look and feel
		this.layout();
	}

	public setProperties(properties: { [key: string]: any; }): void {
		super.setProperties(properties);
		this._tableData.clear();
		this._tableData.push(TableComponent.transformData(this.data, this.columns));
		this._tableColumns = this.transformColumns(this.columns);
		this._table.columns = this._tableColumns;
		this._table.setData(this._tableData);
		this._table.setTableTitle(this.title);
		if (this.selectedRows) {
			this._table.setSelectedRows(this.selectedRows);
		}

		Object.keys(this._checkboxColumns).forEach(col => this.registerPlugins(col, this._checkboxColumns[col]));
		Object.keys(this._buttonsColumns).forEach(col => this.registerPlugins(col, this._buttonsColumns[col]));

		if (this.headerFilter === true) {
			this.registerFilterPlugin();
			this._tableData.clearFilter();
		}
		if (this.ariaRowCount === -1) {
			this._table.removeAriaRowCount();
		}
		else {
			this._table.ariaRowCount = this.ariaRowCount;
		}

		if (this.ariaColumnCount === -1) {
			this._table.removeAriaColumnCount();
		}
		else {
			this._table.ariaColumnCount = this.ariaColumnCount;
		}

		if (this.ariaRole) {
			this._table.ariaRole = this.ariaRole;
		}

		if (this.ariaLabel) {
			this._table.ariaLabel = this.ariaLabel;
		}

		if (this.updateCells !== undefined) {
			this.updateTableCells(this.updateCells);
		}

		this.layoutTable();
		this.validate();
	}

	private updateTableCells(cellInfos): void {
		cellInfos.forEach((cellInfo) => {
			if (isUndefinedOrNull(cellInfo.column) || isUndefinedOrNull(cellInfo.row) || cellInfo.row < 0 || cellInfo.row > this.data.length) {
				return;
			}

			const checkInfo: azdata.CheckBoxCell = cellInfo as azdata.CheckBoxCell;
			if (checkInfo) {
				this._checkboxColumns[checkInfo.columnName].reactiveCheckboxCheck(checkInfo.row, checkInfo.checked);
			}
		});
	}

	private createCheckBoxPlugin(col: any, index: number) {
		let name = col.value;
		if (!this._checkboxColumns[col.value]) {
			this._checkboxColumns[col.value] = new CheckboxSelectColumn({
				title: col.value,
				toolTip: col.toolTip,
				width: col.width,
				cssClass: col.cssClass,
				headerCssClass: col.headerCssClass,
				actionOnCheck: col.options ? col.options.actionOnCheckbox : null
			}, index);

			this._register(this._checkboxColumns[col.value].onChange((state) => {
				this.fireEvent({
					eventType: ComponentEventType.onCellAction,
					args: {
						row: state.row,
						column: state.column,
						checked: state.checked,
						name: name
					}
				});
			}));
		}
	}

	private createButtonPlugin(col: any) {
		let name = col.value;
		if (!this._buttonsColumns[col.value]) {
			this._buttonsColumns[col.value] = new ButtonColumn({
				title: col.title,
				iconCssClass: 'modelview-table-button-icon  ' + (col.options ? createIconCssClass(col.options.icon) : '')
			});

			this._register(this._buttonsColumns[col.value].onClick((state) => {
				this.fireEvent({
					eventType: ComponentEventType.onCellAction,
					args: {
						row: state.row,
						column: state.column,
						name: name
					}
				});
			}));
		}
	}

	private registerPlugins(col: string, plugin: CheckboxSelectColumn<{}> | ButtonColumn<{}>): void {

		const index = 'index' in plugin ? plugin.index : this.columns?.findIndex(x => x === col || ('value' in x && x['value'] === col));
		if (index >= 0) {
			this._tableColumns.splice(index, 0, plugin.definition);
			if (!(col in this._pluginsRegisterStatus) || !this._pluginsRegisterStatus[col]) {
				this._table.registerPlugin(plugin);
				this._pluginsRegisterStatus[col] = true;
			}
		}

		this._table.columns = this._tableColumns;
		this._table.autosizeColumns();

	}


	private registerFilterPlugin() {
		const filterPlugin = new HeaderFilter<Slick.SlickData>();
		this._register(attachButtonStyler(filterPlugin, this.themeService));
		this._filterPlugin = filterPlugin;
		this._filterPlugin.onFilterApplied.subscribe((e, args) => {
			let filterValues = (<any>args).column.filterValues;
			if (filterValues) {
				this._tableData.filter();
				this._table.grid.resetActiveCell();
				this.data = this._tableData.getItems().map(dataObject => Object.values(dataObject));
				this.layoutTable();
			} else {
				this._tableData.clearFilter();
			}
		});

		this._filterPlugin.onCommand.subscribe((e, args: any) => {
			this._tableData.sort({
				sortAsc: args.command === 'sort-asc',
				sortCol: args.column,
				multiColumnSort: false,
				grid: this._table.grid
			});
			this.layoutTable();
		});

		this._table.registerPlugin(filterPlugin);
	}

	public focus(): void {
		if (this._table.grid.getDataLength() > 0) {
			if (!this._table.grid.getActiveCell()) {
				this._table.grid.setActiveCell(0, 0);
			}
			this._table.grid.getActiveCellNode().focus();
		}
	}

	// CSS-bound properties

	public get data(): any[][] {
		return this.getPropertyOrDefault<any[]>((props) => props.data, []);
	}

	public set data(newValue: any[][]) {
		this.setPropertyFromUI<any[][]>((props, value) => props.data = value, newValue);
	}

	public get columns(): string[] | azdata.TableColumn[] {
		return this.getPropertyOrDefault<string[] | azdata.TableColumn[]>((props) => props.columns, []);
	}

	public get fontSize(): number | string {
		return this.getPropertyOrDefault<number | string>((props) => props.fontSize, '');
	}

	public set columns(newValue: string[] | azdata.TableColumn[]) {
		this.setPropertyFromUI<string[] | azdata.TableColumn[]>((props, value) => props.columns = value, newValue);
	}

	public get selectedRows(): number[] {
		return this.getPropertyOrDefault<number[]>((props) => props.selectedRows, []);
	}

	public set selectedRows(newValue: number[]) {
		this.setPropertyFromUI<number[]>((props, value) => props.selectedRows = value, newValue);
	}

	public get forceFitColumns() {
		return this.getPropertyOrDefault<ColumnSizingMode>((props) => props.forceFitColumns, ColumnSizingMode.ForceFit);
	}

	public get title() {
		return this.getPropertyOrDefault<string>((props) => props.title, '');
	}

	public get ariaRowCount(): number {
		return this.getPropertyOrDefault<number>((props) => props.ariaRowCount, -1);
	}

	public get ariaColumnCount(): number {
		return this.getPropertyOrDefault<number>((props) => props.ariaColumnCount, -1);
	}

	public set moveFocusOutWithTab(newValue: boolean) {
		this.setPropertyFromUI<boolean>((props, value) => props.moveFocusOutWithTab = value, newValue);
	}

	public get moveFocusOutWithTab(): boolean {
		return this.getPropertyOrDefault<boolean>((props) => props.moveFocusOutWithTab, false);
	}

	public get updateCells(): azdata.TableCell[] {
		return this.getPropertyOrDefault<azdata.TableCell[]>((props) => props.updateCells, undefined);
	}

	public set updateCells(newValue: azdata.TableCell[]) {
		this.setPropertyFromUI<azdata.TableCell[]>((properties, value) => { properties.updateCells = value; }, newValue);
	}

	public get headerFilter(): boolean {
		return this.getPropertyOrDefault<boolean>((props) => props.headerFilter, false);
	}
}

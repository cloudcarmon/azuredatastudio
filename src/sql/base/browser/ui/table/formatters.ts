/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from 'sql/base/common/strings';
import { localize } from 'vs/nls';

export interface DBCellValue {
	displayValue: string;
	isNull: boolean;
}

/**
 * Info for executing a command. @see azdata.ExecuteCommandInfo
 */
export interface ExecuteCommandInfo {
	id: string;
	args?: string[]
}

/**
 * The info for a DataGrid Text Cell.
 */
export interface TextCellValue {
	text: string;
	ariaLabel: string;
}

/**
 * The info for a DataGrid Hyperlink Cell.
 */
export interface HyperlinkCellValue {
	displayText: string;
	linkOrCommand: string | ExecuteCommandInfo;
}

export namespace DBCellValue {
	export function isDBCellValue(object: any): boolean {
		return (object !== undefined && object.displayValue !== undefined && object.isNull !== undefined);
	}
}

/**
 * Checks whether the specified object is a HyperlinkCellValue object or not
 * @param obj The object to test
 */
export function isHyperlinkCellValue(obj: any | undefined): obj is HyperlinkCellValue {
	return !!(<HyperlinkCellValue>obj)?.linkOrCommand;
}


/**
 * Format xml field into a hyperlink and performs HTML entity encoding
 */
export function hyperLinkFormatter(row: number | undefined, cell: any | undefined, value: any, columnDef: any | undefined, dataContext: any | undefined): string {
	let cellClasses = 'grid-cell-value-container';
	let valueToDisplay: string = '';

	if (DBCellValue.isDBCellValue(value)) {
		valueToDisplay = 'NULL';
		if (!value.isNull) {
			cellClasses += ' xmlLink';
			valueToDisplay = escape(value.displayValue);
			return `<a class="${cellClasses}" href="#" >${valueToDisplay}</a>`;
		} else {
			cellClasses += ' missing-value';
		}
	} else if (isHyperlinkCellValue(value)) {
		return `<a class="${cellClasses}" href="#" >${escape(value.displayText)}</a>`;
	}
	return `<span title="${valueToDisplay}" class="${cellClasses}">${valueToDisplay}</span>`;
}

/**
 * Format all text to replace all new lines with spaces and performs HTML entity encoding
 */
export function textFormatter(row: number | undefined, cell: any | undefined, value: any, columnDef: any | undefined, dataContext: any | undefined): string {
	let cellClasses = 'grid-cell-value-container';
	let valueToDisplay = '';
	let titleValue = '';

	if (DBCellValue.isDBCellValue(value)) {
		valueToDisplay = 'NULL';
		if (!value.isNull) {
			valueToDisplay = value.displayValue.replace(/(\r\n|\n|\r)/g, ' ');
			valueToDisplay = escape(valueToDisplay.length > 250 ? valueToDisplay.slice(0, 250) + '...' : valueToDisplay);
			titleValue = valueToDisplay;
		} else {
			cellClasses += ' missing-value';
		}
	} else if (typeof value === 'string' || (value && value.text)) {
		if (value.text) {
			valueToDisplay = value.text;
		} else {
			valueToDisplay = value;
		}
		valueToDisplay = escape(valueToDisplay.length > 250 ? valueToDisplay.slice(0, 250) + '...' : valueToDisplay);
		titleValue = valueToDisplay;
	}

	return `<span title="${titleValue}" class="${cellClasses}">${valueToDisplay}</span>`;
}

export function imageFormatter(row: number | undefined, cell: any | undefined, value: any, columnDef: any | undefined, dataContext: any | undefined): string {
	return `<img src="${value.text}" />`;
}

/**
 * Provide slick grid cell with encoded ariaLabel and plain text.
 * text will be escaped by the textFormatter and ariaLabel will be consumed by slickgrid directly.
 */
export function slickGridDataItemColumnValueExtractor(value: any, columnDef: any): TextCellValue | HyperlinkCellValue {
	let fieldValue = value[columnDef.field];
	if (columnDef.type === 'hyperlink') {
		return <HyperlinkCellValue>{
			displayText: fieldValue.displayText,
			linkOrCommand: fieldValue.linkOrCommand
		};
	} else {
		return <TextCellValue>{
			text: fieldValue,
			ariaLabel: fieldValue ? escape(fieldValue) : fieldValue
		};
	}

}

/**
 * Alternate function to provide slick grid cell with ariaLabel and plain text
 * In this case, for no display value ariaLabel will be set to specific string "no data available" for accessibily support for screen readers
 * Set 'no data' label only if cell is present and has no value (so that checkbox and other custom plugins do not get 'no data' label)
 */
export function slickGridDataItemColumnValueWithNoData(value: any, columnDef: any): { text: string; ariaLabel: string; } {
	let displayValue = value[columnDef.field];
	if (typeof displayValue === 'number') {
		displayValue = displayValue.toString();
	}
	if (displayValue instanceof Array) {
		displayValue = displayValue.toString();
	}
	return {
		text: displayValue,
		ariaLabel: displayValue ? escape(displayValue) : ((displayValue !== undefined) ? localize("tableCell.NoDataAvailable", "no data available") : displayValue)
	};
}

/** The following code is a rewrite over the both formatter function using dom builder
 * rather than string manipulation, which is a safer and easier method of achieving the same goal.
 * However, when electron is in "Run as node" mode, dom creation acts differently than normal and therefore
 * the tests to test for html escaping fail. I'm keeping this code around as we should migrate to it if we ever
 * integrate into actual DOM testing (electron running in normal mode) later on.

export const hyperLinkFormatter: Slick.Formatter<any> = (row, cell, value, columnDef, dataContext): string => {
	let classes: Array<string> = ['grid-cell-value-container'];
	let displayValue = '';

	if (DBCellValue.isDBCellValue(value)) {
		if (!value.isNull) {
			displayValue = value.displayValue;
			classes.push('queryLink');
			let linkContainer = $('a', {
				class: classes.join(' '),
				title: displayValue
			});
			linkContainer.innerText = displayValue;
			return linkContainer.outerHTML;
		} else {
			classes.push('missing-value');
		}
	}

	let cellContainer = $('span', { class: classes.join(' '), title: displayValue });
	cellContainer.innerText = displayValue;
	return cellContainer.outerHTML;
};

export const textFormatter: Slick.Formatter<any> = (row, cell, value, columnDef, dataContext): string => {
	let displayValue = '';
	let classes: Array<string> = ['grid-cell-value-container'];

	if (DBCellValue.isDBCellValue(value)) {
		if (!value.isNull) {
			displayValue = value.displayValue.replace(/(\r\n|\n|\r)/g, ' ');
		} else {
			classes.push('missing-value');
			displayValue = 'NULL';
		}
	}

	let cellContainer = $('span', { class: classes.join(' '), title: displayValue });
	cellContainer.innerText = displayValue;

	return cellContainer.outerHTML;
};

*/

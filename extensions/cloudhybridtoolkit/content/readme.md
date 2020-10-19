# Azure SQL Hybrid Cloud Toolkit

The **Azure SQL Hybrid Cloud Toolkit** is a collection of [Notebooks](https://docs.microsoft.com/en-us/sql/azure-data-studio/notebooks-guidance) intended to be ran within [Azure Data Studio](https://docs.microsoft.com/en-us/sql/azure-data-studio/download-azure-data-studio). It has chapters on network configuration, assessment, [Azure](https://portal.azure.com) resource provisioning, and migration. Contribution is welcome and appreciated!


## Pre-requisites and Initial Setup
The notebooks may leverage various modules from Microsoft PowerShell and the OSS community. To execute the notebooks in this toolkit, see the [Prequisites and Initial Setup Notebook](prereqs.ipynb) where all pre-requisite modules will be checked and installed if not found.

## Chapters
* [Networking](networking/readme.md) - Setup secure Point-to-Site (P2S) or Site-to-Site (S2S) network connectivity to Microsoft Azure using a Virtual Private Network (VPN). This notebook serves as a building block for other notebooks as communicating securely between on-premise and Azure is essential for many tasks
* [Assessments](Assessments/readme.md) - Notebooks that contain examples to determine whether a given database or SQL Server instance is ready to migrate by utilizing SQL Assessments. SQL instances are scanned based on a "best practices" set of rules. 
* [Provisioning](provisioning/readme.md) - Creating and communicating with SQL Resources in Microsoft Azure. Includes common tasks such as creating SQL Virtual Machines or SQL Managed Instances in the cloud
* [Data Portability](data-portability/readme.md) - Install a custom Azure function to facilitate importing and exporting cloud resources. The solution uses parallel tasks in Azure Batch to perform data storage work. Azure Batch is a process that runs large-scale parallel and high-performance computing jobs efficiently in Azure. 
* [High Availability and Disaster Recovery](hadr/readme.md) - Notebooks to leverage Azure SQL for business continuity in a hybrid cloud environment
* [Offline Migration](offline-migration/readme.md) - Notebooks to perform various migrations

## Goals
The purpose of this toolkit is to help Azure data engineers and other information workers deploy, migrate and manage SQL Server instances and databases in a hybrid Azure cloud environment. The collection of notebooks better position a data engineer with regards to planning, migrating, and thriving by:
* Offering a baseline of knowledge as executable ADS Notebooks
* Enabling an assessment of existing data resources
* Bootstrap a completely scalable solution for migrating SQL databases using parallelism
* Presenting the best practices and secure solutions for data tasks

## How to Use the Toolkit
Most notebooks require some configuration. If so, the proper configurations should be clearly located towards the top of the notebook or cell, whichever is most appropriate. By design, Notebooks are written to be executed from top-to-bottom. Therefore, each notebook has a specific task to perform and should focus only on that task. It may contain several cells to execute but it will adhere to the one-task per notebook paradigm. 

It needs to be mentioned that executing a notebook without knowing exactly what it does is not good practice. Make sure the repercussions of executing a cell are known before executing. 

## Contributing
Create a pull request on the official [Git Repo](https://www.github.com) (need link).